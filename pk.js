////////////////////////////////////////////////////////////
// PK 0.8
// Variables, funciones, condiciones, bucles, listas, HTML,
// eventos, temporizadores, carga de página y recarga
////////////////////////////////////////////////////////////

const MAX_ITERACIONES = 100000;
const MAX_PROFUNDIDAD = 200;

const memoria = { funciones: {} };
let ambitos = [];
let salidaPk = [];
let tokensActuales = [];
let posicion = 0;
let leyendo = false;
let profundidad = 0;

// Estado de lo que ocurre "después" (tiempo, eventos, carga)
let temporizadores = new Set();
let escuchas = [];
let bloquesCargar = [];
let cargaIniciada = false;
let temporizadorActual = null;

// Objeto público: Pk.ejecutar(codigo), Pk.detener(),
// Pk.alMostrar = (texto) => {...}, Pk.alRecargar = () => {...}
const Pk = {
    version: "0.8",
    alMostrar: null,
    alRecargar: null,
    ejecutar: (codigo) => ejecutar(codigo),
    detener: () => detenerTodo()
};

const RESERVADAS = new Set([
    "ver", "far", "nulo", "optenerElemento", "obtenerElemento",
    "ventana", "documento", "crear", "cambiar", "mostrar", "retornar",
    "funcion", "si", "mientras", "romper", "continuar"
]);

// Nombres que Pk no deja usar (evitan llegar a eval, Function, etc.)
const PROHIBIDOS = new Set([
    "constructor", "__proto__", "prototype", "eval", "Function",
    "setTimeout", "setInterval", "defaultView", "ownerDocument",
    "contentWindow", "contentDocument", "location", "write", "writeln",
    "open", "cookie", "localStorage", "sessionStorage", "top", "parent",
    "opener"
]);

const tiene = (objeto, clave) =>
    Object.prototype.hasOwnProperty.call(objeto, clave);

////////////////////////////////////////////////////////////
// ERRORES Y SALIDA
////////////////////////////////////////////////////////////

class PkError extends Error {
    constructor(mensaje, linea) {
        super("Pk: " + mensaje);
        this.linea = linea;
    }
}

function errorPk(mensaje, linea) {
    if (linea === undefined && leyendo) linea = actual()?.linea;
    throw new PkError(mensaje, linea);
}

function esControl(error) {
    return (
        !!error &&
        !(error instanceof Error) &&
        ["RETORNO", "ROMPER", "CONTINUAR"].includes(error.tipo)
    );
}

function mensajeError(error) {
    if (esControl(error)) {
        if (error.tipo === "RETORNO") {
            return "Pk: 'retornar' solo se puede usar dentro de una función";
        }
        const palabra = error.tipo === "ROMPER" ? "romper" : "continuar";
        return "Pk: '" + palabra + "' solo se puede usar dentro de un bucle";
    }

    if (error instanceof PkError) {
        return error.linea
            ? error.message + " (línea " + error.linea + ")"
            : error.message;
    }

    return "Pk: " + (error?.message || String(error));
}

function emitir(texto) {
    salidaPk.push(texto);
    if (typeof Pk.alMostrar === "function") {
        try {
            Pk.alMostrar(texto);
        } catch (e) {
            console.error(e);
        }
    }
}

function formatear(valor, dentroDeLista = false) {
    if (valor === null || valor === undefined) return "nulo";
    if (valor === true) return "ver";
    if (valor === false) return "far";
    if (typeof valor === "string") {
        return dentroDeLista ? '"' + valor + '"' : valor;
    }
    if (esLista(valor)) {
        return "[" + Array.from(valor).map((v) => formatear(v, true)).join(", ") + "]";
    }
    if (esElemento(valor)) return "<" + valor.tagName.toLowerCase() + ">";
    return String(valor);
}

////////////////////////////////////////////////////////////
// VARIABLES
////////////////////////////////////////////////////////////

function buscarVariable(nombre) {
    for (let i = ambitos.length - 1; i >= 0; i--) {
        if (tiene(ambitos[i], nombre)) return ambitos[i][nombre];
    }
    errorPk("Variable desconocida: " + nombre);
}

function crearVariable(nombre, valor, tipo) {
    if (RESERVADAS.has(nombre)) {
        errorPk("«" + nombre + "» es una palabra reservada de Pk");
    }
    const ambito = ambitos[ambitos.length - 1];
    if (tiene(ambito, nombre)) errorPk("La variable ya existe: " + nombre);
    ambito[nombre] = { valor, tipo };
}

function cambiarVariable(nombre, valor) {
    for (let i = ambitos.length - 1; i >= 0; i--) {
        if (tiene(ambitos[i], nombre)) {
            if (ambitos[i][nombre].tipo === "const") {
                errorPk("No puedes modificar una constante: " + nombre);
            }
            ambitos[i][nombre].valor = valor;
            return;
        }
    }
    errorPk("No existe la variable: " + nombre);
}

////////////////////////////////////////////////////////////
// TOKENIZER
////////////////////////////////////////////////////////////

function tokenizar(codigo) {
    const tokens = [];
    let i = 0;
    let linea = 1;

    while (i < codigo.length) {
        const c = codigo[i];

        if (c === "\n") {
            linea++;
            i++;
            continue;
        }

        if (/\s/.test(c) || c === ";") {
            i++;
            continue;
        }

        // Comentario de línea
        if (c === "/" && codigo[i + 1] === "/") {
            while (i < codigo.length && codigo[i] !== "\n") i++;
            continue;
        }

        // Comentario de bloque
        if (c === "/" && codigo[i + 1] === "*") {
            const lineaInicio = linea;
            i += 2;
            while (i < codigo.length && !(codigo[i] === "*" && codigo[i + 1] === "/")) {
                if (codigo[i] === "\n") linea++;
                i++;
            }
            if (i >= codigo.length) errorPk("Comentario sin cerrar", lineaInicio);
            i += 2;
            continue;
        }

        // Texto
        if (c === '"' || c === "'") {
            const comilla = c;
            const lineaInicio = linea;
            i++;
            let texto = "";

            while (i < codigo.length && codigo[i] !== comilla) {
                if (codigo[i] === "\\" && i + 1 < codigo.length) {
                    i++;
                    const especiales = { n: "\n", t: "\t", r: "\r" };
                    texto += especiales[codigo[i]] ?? codigo[i];
                } else {
                    if (codigo[i] === "\n") linea++;
                    texto += codigo[i];
                }
                i++;
            }

            if (codigo[i] !== comilla) errorPk("Texto sin cerrar", lineaInicio);
            i++;
            tokens.push({ tipo: "texto", valor: texto, linea: lineaInicio });
            continue;
        }

        // Número
        if (/[0-9]/.test(c)) {
            let numero = "";
            while (i < codigo.length && /[0-9.]/.test(codigo[i])) {
                numero += codigo[i++];
            }
            if ((numero.match(/\./g) || []).length > 1) {
                errorPk("Número inválido: " + numero, linea);
            }
            tokens.push({ tipo: "numero", valor: Number(numero), linea });
            continue;
        }

        // Identificador
        if (/[a-zA-Z_$áéíóúÁÉÍÓÚñÑ]/.test(c)) {
            let nombre = "";
            while (
                i < codigo.length &&
                /[a-zA-Z0-9_$áéíóúÁÉÍÓÚñÑ]/.test(codigo[i])
            ) {
                nombre += codigo[i++];
            }
            tokens.push({ tipo: "identificador", valor: nombre, linea });
            continue;
        }

        const triple = codigo.slice(i, i + 3);
        if (["===", "!=="].includes(triple)) {
            tokens.push({ tipo: "operador", valor: triple, linea });
            i += 3;
            continue;
        }

        const doble = codigo.slice(i, i + 2);
        if (
            ["==", "!=", ">=", "<=", "&&", "||", "**",
             "+=", "-=", "*=", "/=", "++", "--"].includes(doble)
        ) {
            tokens.push({ tipo: "operador", valor: doble, linea });
            i += 2;
            continue;
        }

        if ("+-*/%><!().,={}[]".includes(c)) {
            tokens.push({ tipo: "simbolo", valor: c, linea });
            i++;
            continue;
        }

        errorPk("Carácter desconocido: " + c, linea);
    }

    tokens.push({ tipo: "fin", valor: "fin", linea });
    return tokens;
}

////////////////////////////////////////////////////////////
// TOKEN HELPERS
////////////////////////////////////////////////////////////

function actual() {
    return tokensActuales[posicion];
}

// Un token "coincide" solo si es palabra o símbolo (no un texto o número)
function coincide(token, valor) {
    return (
        !!token &&
        token.tipo !== "texto" &&
        token.tipo !== "numero" &&
        token.tipo !== "fin" &&
        token.valor === valor
    );
}

function describir(token) {
    if (!token || token.tipo === "fin") return "el final del código";
    if (token.tipo === "texto") return '"' + token.valor + '"';
    return String(token.valor);
}

function aceptar(valor) {
    if (coincide(actual(), valor)) {
        posicion++;
        return true;
    }
    return false;
}

function exigir(valor) {
    if (!aceptar(valor)) {
        errorPk("Se esperaba «" + valor + "» pero se encontró " + describir(actual()));
    }
}

function siguienteEs(valor) {
    return coincide(tokensActuales[posicion + 1], valor);
}

function leerNombre(mensaje) {
    const token = actual();
    if (token.tipo !== "identificador") errorPk(mensaje);
    posicion++;
    return token.valor;
}

////////////////////////////////////////////////////////////
// EXPRESSION PARSER
////////////////////////////////////////////////////////////

const NIVELES = {
    "||": 1,
    "&&": 2,
    "==": 3, "!=": 3, "===": 3, "!==": 3,
    ">": 4, "<": 4, ">=": 4, "<=": 4,
    "+": 5, "-": 5,
    "*": 6, "/": 6, "%": 6,
    "**": 7
};

function precedencia(token) {
    if (token.tipo !== "operador" && token.tipo !== "simbolo") return 0;
    return tiene(NIVELES, token.valor) ? NIVELES[token.valor] : 0;
}

function expresion(nivel = 0) {
    let izquierda = primario();

    while (true) {
        const token = actual();
        const nivelActual = precedencia(token);
        if (nivelActual <= nivel) break;

        posicion++;
        const op = token.valor;
        const derecha = expresion(op === "**" ? nivelActual - 1 : nivelActual);

        izquierda = { tipo: "operacion", operador: op, izquierda, derecha };
    }

    return izquierda;
}

function leerArgumentos() {
    const argumentos = [];
    if (!aceptar(")")) {
        do {
            argumentos.push(expresion());
        } while (aceptar(","));
        exigir(")");
    }
    return argumentos;
}

function primario() {
    const token = actual();

    if (token.tipo === "numero" || token.tipo === "texto") {
        posicion++;
        return continuarPostfijos({ tipo: "literal", valor: token.valor });
    }

    if (aceptar("(")) {
        const resultado = expresion();
        exigir(")");
        return continuarPostfijos(resultado);
    }

    if (aceptar("[")) {
        const elementos = [];
        if (!aceptar("]")) {
            do {
                elementos.push(expresion());
            } while (aceptar(","));
            exigir("]");
        }
        return continuarPostfijos({ tipo: "lista", elementos });
    }

    if (aceptar("!")) {
        return { tipo: "unario", operador: "!", valor: expresion(7) };
    }

    if (aceptar("-")) {
        return { tipo: "unario", operador: "-", valor: expresion(7) };
    }

    if (token.tipo === "identificador") {
        posicion++;
        let resultado = { tipo: "identificador", nombre: token.valor };

        if (aceptar("(")) {
            resultado = {
                tipo: "llamada",
                nombre: token.valor,
                argumentos: leerArgumentos()
            };
        }

        return continuarPostfijos(resultado);
    }

    errorPk("Expresión inválida cerca de: " + describir(token));
}

// .propiedad  .metodo()  [posicion]
function continuarPostfijos(objeto) {
    while (true) {
        if (aceptar(".")) {
            const token = actual();
            if (token.tipo !== "identificador") {
                errorPk("Se esperaba el nombre de una propiedad");
            }
            posicion++;

            if (aceptar("(")) {
                objeto = {
                    tipo: "metodo",
                    objeto,
                    propiedad: token.valor,
                    argumentos: leerArgumentos()
                };
            } else {
                objeto = { tipo: "propiedad", objeto, propiedad: token.valor };
            }
        } else if (aceptar("[")) {
            const indice = expresion();
            exigir("]");
            objeto = { tipo: "indice", objeto, indice };
        } else {
            break;
        }
    }
    return objeto;
}

////////////////////////////////////////////////////////////
// OPERATORS
////////////////////////////////////////////////////////////

function operar(a, op, b) {
    switch (op) {
        case "+":
            return (typeof a === "string" || typeof b === "string")
                ? formatear(a) + formatear(b) : a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/":
            if (b === 0) errorPk("No se puede dividir entre cero");
            return a / b;
        case "%":
            if (b === 0) errorPk("No se puede calcular el resto entre cero");
            return a % b;
        case "**": return a ** b;
        case "==":
        case "===": return a === b;
        case "!=":
        case "!==": return a !== b;
        case ">": return a > b;
        case "<": return a < b;
        case ">=": return a >= b;
        case "<=": return a <= b;
        case "&&": return Boolean(a && b);
        case "||": return Boolean(a || b);
        default: errorPk("Operador desconocido: " + op);
    }
}

////////////////////////////////////////////////////////////
// EVALUATE EXPRESSIONS
////////////////////////////////////////////////////////////

function evaluarIdentificador(nombre) {
    switch (nombre) {
        case "ver": return true;
        case "far": return false;
        case "nulo": return null;
        case "optenerElemento":
        case "obtenerElemento": return optenerElemento;
        case "ventana": return typeof window !== "undefined" ? window : null;
        case "documento": return typeof document !== "undefined" ? document : null;
    }
    return buscarVariable(nombre).valor;
}

function evaluar(nodo) {
    if (!nodo) return null;

    switch (nodo.tipo) {
        case "literal":
            return nodo.valor;

        case "lista":
            return nodo.elementos.map(evaluar);

        case "identificador":
            return evaluarIdentificador(nodo.nombre);

        case "operacion": {
            const a = evaluar(nodo.izquierda);
            if (nodo.operador === "&&" && !a) return false;
            if (nodo.operador === "||" && a) return true;
            return operar(a, nodo.operador, evaluar(nodo.derecha));
        }

        case "unario": {
            const valor = evaluar(nodo.valor);
            if (nodo.operador === "!") return !Boolean(valor);
            if (nodo.operador === "-") return -Number(valor);
            errorPk("Operador unario desconocido");
        }

        case "llamada":
            return llamarFuncion(nodo.nombre, nodo.argumentos.map(evaluar));

        case "propiedad":
            return obtenerPropiedad(evaluar(nodo.objeto), nodo.propiedad);

        case "indice":
            return obtenerIndice(evaluar(nodo.objeto), evaluar(nodo.indice));

        case "metodo":
            return obtenerMetodo(
                evaluar(nodo.objeto),
                nodo.propiedad,
                nodo.argumentos.map(evaluar)
            );

        default:
            errorPk("No se puede evaluar esta expresión");
    }
}

////////////////////////////////////////////////////////////
// HTML ELEMENTS Y LISTAS
////////////////////////////////////////////////////////////

const optenerElemento = {};

const esElemento = (v) => typeof Element !== "undefined" && v instanceof Element;
const esEstilo = (v) =>
    typeof CSSStyleDeclaration !== "undefined" && v instanceof CSSStyleDeclaration;
const esColeccionHTML = (v) =>
    (typeof HTMLCollection !== "undefined" && v instanceof HTMLCollection) ||
    (typeof NodeList !== "undefined" && v instanceof NodeList);
const esLista = (v) => Array.isArray(v) || esColeccionHTML(v);

// Nombres en español -> nombres reales de JS
const PROP_ELEMENTO = {
    texto: "textContent", html: "innerHTML", valor: "value",
    clase: "className", className: "className",
    padre: "parentElement", hijos: "children", estilo: "style"
};

const PROP_ESTILO = {
    color: "color", fondo: "background", ancho: "width", alto: "height",
    tamano: "fontSize", "tamaño": "fontSize", borde: "border",
    margen: "margin", relleno: "padding", opacidad: "opacity",
    display: "display", posicion: "position"
};

const METODOS = {
    mayusculas: "toUpperCase", minusculas: "toLowerCase", recortar: "trim",
    dividir: "split", incluye: "includes", reemplazar: "replaceAll",
    unir: "join", agregar: "push", sacar: "pop", quitarPrimero: "shift",
    agregarInicio: "unshift", invertir: "reverse", buscarPosicion: "indexOf",
    cortar: "slice", empiezaCon: "startsWith", terminaCon: "endsWith"
};

function verificarNombre(nombre) {
    if (PROHIBIDOS.has(nombre)) errorPk("Pk no permite usar «" + nombre + "»");
}

function exigirElemento(valor, nombre) {
    if (!esElemento(valor)) errorPk(nombre + " necesita un elemento HTML");
}

function crearElemento(etiqueta) {
    return document.createElement(String(etiqueta));
}

// item(n): n puede ser negativo para contar desde el final
function itemDe(coleccion, n) {
    const numero = Number(n);
    if (!Number.isInteger(numero)) {
        errorPk("item necesita un número entero, por ejemplo item(0)");
    }
    const lista = Array.from(coleccion);
    return lista[numero < 0 ? lista.length + numero : numero] ?? null;
}

function ordenarLista(lista) {
    return lista.sort((a, b) =>
        typeof a === "number" && typeof b === "number"
            ? a - b
            : String(a).localeCompare(String(b))
    );
}

function consultarElemento(metodo, argumentos) {
    const valor = String(argumentos[0] ?? "");
    switch (metodo) {
        case "id": return document.getElementById(valor);
        case "class":
        case "clase": return document.getElementsByClassName(valor);
        case "etiqueta": return document.getElementsByTagName(valor);
        case "selector": return document.querySelector(valor);
        case "selectorTodos": return document.querySelectorAll(valor);
    }
    errorPk("Método desconocido: optenerElemento." + metodo);
}

// Métodos extra para elementos HTML
const metodosElemento = {
    agregar: (e, hijo) => agregarHijo(hijo, e),
    eliminar: (e) => { e.remove(); return null; },
    limpiar: (e) => { e.innerHTML = ""; return null; },
    agregarClase: (e, ...c) => { e.classList.add(...c.map(String)); return null; },
    quitarClase: (e, ...c) => { e.classList.remove(...c.map(String)); return null; },
    alternarClase: (e, c) => e.classList.toggle(String(c)),
    tieneClase: (e, c) => e.classList.contains(String(c)),
    ocultar: (e) => { e.style.display = "none"; return null; },
    aparecer: (e, d = "") => { e.style.display = String(d); return null; },
    enfocar: (e) => { e.focus(); return null; },
    hacerClic: (e) => { e.click(); return null; },
    buscar: (e, selector) => e.querySelector(String(selector)),
    buscarTodos: (e, selector) => e.querySelectorAll(String(selector)),
    quitarAtributo: (e, nombre) => { e.removeAttribute(String(nombre)); return null; },
    atributo: (e, nombre, valor) => {
        nombre = String(nombre);
        if (valor === undefined) return e.getAttribute(nombre);
        if (/^on/i.test(nombre)) errorPk("No puedes poner atributos que empiecen por «on»");
        e.setAttribute(nombre, String(valor));
        return valor;
    }
};

function obtenerMetodo(objeto, metodo, argumentos) {
    if (objeto == null) errorPk("No se puede usar «" + metodo + "» en un valor vacío");
    verificarNombre(metodo);

    if (objeto === optenerElemento) return consultarElemento(metodo, argumentos);

    if (esLista(objeto)) {
        if (metodo === "item") return itemDe(objeto, argumentos[0]);
        if (metodo === "primero") return itemDe(objeto, 0);
        if (metodo === "ultimo") return itemDe(objeto, -1);
        if (Array.isArray(objeto) && metodo === "ordenar") return ordenarLista(objeto);

        // En un grupo de elementos HTML, el método se aplica a todos
        if (!Array.isArray(objeto) && tiene(metodosElemento, metodo)) {
            Array.from(objeto).forEach((e) => metodosElemento[metodo](e, ...argumentos));
            return null;
        }
    }

    if (esElemento(objeto) && tiene(metodosElemento, metodo)) {
        return metodosElemento[metodo](objeto, ...argumentos);
    }

    const real = tiene(METODOS, metodo) ? METODOS[metodo] : metodo;
    if (typeof objeto[real] !== "function") {
        errorPk("Método desconocido: " + metodo);
    }

    return objeto[real](...argumentos);
}

function obtenerPropiedad(objeto, propiedad) {
    if (objeto == null) {
        errorPk("No se puede leer «" + propiedad + "» de un objeto vacío");
    }
    verificarNombre(propiedad);

    if (esElemento(objeto)) {
        if (tiene(PROP_ESTILO, propiedad)) return objeto.style[PROP_ESTILO[propiedad]];
        if (tiene(PROP_ELEMENTO, propiedad)) return objeto[PROP_ELEMENTO[propiedad]];
        return objeto[propiedad];
    }

    if (esEstilo(objeto) && tiene(PROP_ESTILO, propiedad)) {
        return objeto[PROP_ESTILO[propiedad]];
    }

    if (
        (propiedad === "longitud" || propiedad === "cantidad") &&
        (esLista(objeto) || typeof objeto === "string")
    ) {
        return objeto.length;
    }

    return objeto[propiedad];
}

function asignarPropiedad(objeto, propiedad, valor) {
    if (objeto == null) errorPk("No existe el objeto que quieres modificar");
    verificarNombre(propiedad);

    if (esElemento(objeto)) {
        if (tiene(PROP_ESTILO, propiedad)) {
            objeto.style[PROP_ESTILO[propiedad]] = String(valor);
            return;
        }
        if (propiedad === "texto" || propiedad === "html") {
            objeto[PROP_ELEMENTO[propiedad]] = formatear(valor);
            return;
        }
        if (propiedad === "padre" || propiedad === "hijos" || propiedad === "estilo") {
            errorPk("«" + propiedad + "» es solo de lectura");
        }
        if (tiene(PROP_ELEMENTO, propiedad)) {
            const real = PROP_ELEMENTO[propiedad];
            objeto[real] = real === "value" ? valor : String(valor);
            return;
        }
        objeto[propiedad] = valor;
        return;
    }

    if (esEstilo(objeto) && tiene(PROP_ESTILO, propiedad)) {
        objeto[PROP_ESTILO[propiedad]] = String(valor);
        return;
    }

    objeto[propiedad] = valor;
}

function obtenerIndice(objeto, indice) {
    if (objeto == null) errorPk("No se puede leer una posición de un valor vacío");

    if (esLista(objeto) || typeof objeto === "string") {
        return itemDe(objeto, indice);
    }

    return obtenerPropiedad(objeto, String(indice));
}

function asignarIndice(objeto, indice, valor) {
    if (!Array.isArray(objeto)) {
        errorPk("Solo puedes cambiar posiciones de una lista");
    }
    let posicionLista = Number(indice);
    if (!Number.isInteger(posicionLista)) {
        errorPk("La posición debe ser un número entero");
    }
    if (posicionLista < 0) posicionLista += objeto.length;
    if (posicionLista < 0 || posicionLista > objeto.length) {
        errorPk("Posición fuera de la lista");
    }
    objeto[posicionLista] = valor;
}

function asignar(objetivo, valor) {
    switch (objetivo.tipo) {
        case "identificador":
            cambiarVariable(objetivo.nombre, valor);
            break;
        case "propiedad":
            asignarPropiedad(evaluar(objetivo.objeto), objetivo.propiedad, valor);
            break;
        case "indice":
            asignarIndice(evaluar(objetivo.objeto), evaluar(objetivo.indice), valor);
            break;
    }
}

function agregarHijo(elemento, destino) {
    if (!elemento || !destino) {
        errorPk("agregar necesita un elemento y un destino que existan");
    }

    if (esColeccionHTML(destino)) destino = destino[0];

    if (!esElemento(destino)) errorPk("El destino no es un elemento HTML");

    if (typeof Node === "undefined" || !(elemento instanceof Node)) {
        errorPk("El elemento que intentas agregar no es HTML");
    }

    destino.appendChild(elemento);
    return elemento;
}

////////////////////////////////////////////////////////////
// TIEMPO: para(){}, cada(){}, detener()
////////////////////////////////////////////////////////////

function detenerTemporizador(t) {
    if (t.repetido) clearInterval(t.id);
    else clearTimeout(t.id);
    temporizadores.delete(t);
}

function programar(segundos, accion, repetido) {
    const valido =
        typeof segundos === "number" ||
        (typeof segundos === "string" && segundos.trim() !== "");
    let s = valido ? Number(segundos) : NaN;

    if (!Number.isFinite(s) || s < 0) {
        errorPk(
            "El tiempo debe ser un número de segundos, por ejemplo " +
            (repetido ? "cada(1)" : "para(2)")
        );
    }

    if (repetido && s < 0.05) s = 0.05;
    const ms = Math.min(Math.round(s * 1000), 2147483647);

    const t = { id: null, repetido };

    const correr = () => {
        if (!repetido) temporizadores.delete(t);
        const previo = temporizadorActual;
        temporizadorActual = t;
        try {
            accion();
        } catch (error) {
            emitir(mensajeError(error));
        } finally {
            temporizadorActual = previo;
        }
    };

    t.id = repetido ? setInterval(correr, ms) : setTimeout(correr, ms);
    temporizadores.add(t);
}

function detenerTodo() {
    for (const t of Array.from(temporizadores)) detenerTemporizador(t);

    for (const e of escuchas) {
        try {
            e.objetivo.removeEventListener(e.tipo, e.fn);
        } catch (_) { /* nada */ }
    }
    escuchas = [];
    return null;
}

////////////////////////////////////////////////////////////
// EJECUTAR BLOQUES EN UN ÁMBITO (para código "diferido")
////////////////////////////////////////////////////////////

// Guarda los ámbitos de ahora para que el bloque los vea cuando se ejecute
function crearAccion(cuerpo) {
    const cadena = ambitos.slice();
    return () => ejecutarCallback(cadena, cuerpo);
}

function ejecutarCallback(cadena, cuerpo, locales = {}) {
    const guardado = ambitos;
    const profundidadGuardada = profundidad;
    ambitos = [...cadena, {}];
    profundidad = 0;

    try {
        for (const [nombre, valor] of Object.entries(locales)) {
            crearVariable(nombre, valor, "const");
        }
        ejecutarInstrucciones(cuerpo);
    } catch (error) {
        // 'retornar' dentro de un bloque simplemente lo termina
        if (!(esControl(error) && error.tipo === "RETORNO")) {
            emitir(mensajeError(error));
        }
    } finally {
        ambitos = guardado;
        profundidad = profundidadGuardada;
    }
}

////////////////////////////////////////////////////////////
// EVENTOS: evento(elemento, "click") { ... }
////////////////////////////////////////////////////////////

const EVENTOS = {
    clic: "click", click: "click", doble: "dblclick", dobleClic: "dblclick",
    entrar: "mouseenter", salir: "mouseleave", mover: "mousemove",
    presionar: "mousedown", soltar: "mouseup",
    teclaAbajo: "keydown", teclaArriba: "keyup",
    cambio: "change", escribir: "input", enviar: "submit",
    enfocar: "focus", desenfocar: "blur", tocar: "touchstart",
    redimensionar: "resize", desplazar: "scroll"
};

function registrarEvento(objetivo, nombre, cuerpo) {
    if (objetivo == null) {
        errorPk("No se puede agregar un evento a algo vacío (¿existe ese id o class?)");
    }

    nombre = String(nombre);
    const tipo = tiene(EVENTOS, nombre) ? EVENTOS[nombre] : nombre;
    const destinos = esLista(objetivo) ? Array.from(objetivo) : [objetivo];
    const cadena = ambitos.slice();

    for (const destino of destinos) {
        if (!destino || typeof destino.addEventListener !== "function") {
            errorPk("evento necesita un elemento HTML, documento o ventana");
        }

        const fn = (ev) => {
            const locales = { este: destino, ev };
            if (ev && ev.key !== undefined) locales.tecla = ev.key;
            ejecutarCallback(cadena, cuerpo, locales);
        };

        destino.addEventListener(tipo, fn);
        escuchas.push({ objetivo: destino, tipo, fn });
    }
}

////////////////////////////////////////////////////////////
// CARGAR: cargar { ... }
////////////////////////////////////////////////////////////

function correrBloquesCargar() {
    cargaIniciada = true;
    const lista = bloquesCargar;
    bloquesCargar = [];
    for (const bloque of lista) ejecutarCallback(bloque.cadena, bloque.cuerpo);
}

// Si la página ya cargó, los bloques corren ya; si no, esperan a que cargue
function iniciarCarga() {
    if (typeof document === "undefined" || document.readyState !== "loading") {
        correrBloquesCargar();
        return;
    }

    const fn = () => correrBloquesCargar();
    document.addEventListener("DOMContentLoaded", fn, { once: true });
    escuchas.push({ objetivo: document, tipo: "DOMContentLoaded", fn });
}

////////////////////////////////////////////////////////////
// RECARGAR: recargar()  recargar(segundos)
////////////////////////////////////////////////////////////

function recargarPagina() {
    try {
        const ahora = Date.now();
        const marcas = JSON.parse(sessionStorage.getItem("pk_recargas") || "[]")
            .filter((t) => ahora - t < 5000);

        if (marcas.length >= 4) {
            errorPk("Demasiadas recargas seguidas. Pk las detuvo para evitar un bucle infinito");
        }

        marcas.push(ahora);
        sessionStorage.setItem("pk_recargas", JSON.stringify(marcas));
    } catch (error) {
        if (error instanceof PkError) throw error;
    }

    if (typeof Pk.alRecargar === "function") Pk.alRecargar();
    else if (typeof location !== "undefined") location.reload();
    return null;
}

////////////////////////////////////////////////////////////
// FUNCIONES INTEGRADAS
////////////////////////////////////////////////////////////

function tipoDe(valor) {
    if (valor === null || valor === undefined) return "nulo";
    if (typeof valor === "number") return "numero";
    if (typeof valor === "string") return "texto";
    if (typeof valor === "boolean") return "booleano";
    if (esLista(valor)) return "lista";
    if (esElemento(valor)) return "elemento";
    return "objeto";
}

function listaDe(argumentos) {
    return argumentos.length === 1 && esLista(argumentos[0])
        ? Array.from(argumentos[0]).map(Number)
        : argumentos.map(Number);
}

const integradas = {
    // HTML
    crearElemento: (etiqueta) => crearElemento(etiqueta),
    agregar: (elemento, ...resto) =>
        agregarHijo(
            elemento,
            resto.length ? resto[0] : (typeof document !== "undefined" ? document.body : null)
        ),
    eliminar: (e) => { exigirElemento(e, "eliminar"); e.remove(); return null; },
    limpiar: (e) => { exigirElemento(e, "limpiar"); e.innerHTML = ""; return null; },

    // Matemáticas
    aleatorio: (...a) => {
        if (a.length === 0) return Math.random();
        if (a.length !== 2) errorPk("aleatorio necesita dos números: aleatorio(1, 10)");
        const min = Math.ceil(Number(a[0]));
        const max = Math.floor(Number(a[1]));
        if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
            errorPk("aleatorio necesita dos números válidos: aleatorio(1, 10)");
        }
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    redondear: (n, decimales = 0) => {
        const f = 10 ** Number(decimales);
        return Math.round(Number(n) * f) / f;
    },
    suelo: (n) => Math.floor(Number(n)),
    techo: (n) => Math.ceil(Number(n)),
    absoluto: (n) => Math.abs(Number(n)),
    raiz: (n) => Math.sqrt(Number(n)),
    maximo: (...a) => Math.max(...listaDe(a)),
    minimo: (...a) => Math.min(...listaDe(a)),

    // Tipos
    texto: (v) => formatear(v),
    numero: (v) => {
        if (typeof v === "string" && v.trim() === "") return null;
        const n = Number(v);
        return Number.isNaN(n) ? null : n;
    },
    longitud: (v) => {
        if (typeof v === "string" || esLista(v)) return v.length;
        errorPk("longitud necesita un texto o una lista");
    },
    tipo: (v) => tipoDe(v),

    // Utilidades
    ahora: () => Date.now(),
    consola: (...a) => { console.log(...a.map((v) => formatear(v))); return null; },
    alerta: (v) => {
        if (typeof alert === "function") alert(formatear(v));
        return null;
    },
    preguntar: (v) => (typeof prompt === "function" ? prompt(formatear(v)) : null),
    guardar: (clave, valor) => {
        if (esElemento(valor)) errorPk("Solo puedes guardar números, textos, ver/far y listas");
        try {
            localStorage.setItem("pk:" + String(clave), JSON.stringify(valor));
        } catch (_) {
            errorPk("No se pudo guardar «" + clave + "»");
        }
        return valor;
    },
    leer: (clave) => {
        try {
            const texto = localStorage.getItem("pk:" + String(clave));
            return texto === null ? null : JSON.parse(texto);
        } catch (_) {
            return null;
        }
    },
    borrar: (clave) => {
        try { localStorage.removeItem("pk:" + String(clave)); } catch (_) { /* nada */ }
        return null;
    },

    // Control
    recargar: (segundos) => {
        if (segundos === undefined) return recargarPagina();
        programar(segundos, recargarPagina, false);
        return null;
    },
    detener: () => {
        if (!temporizadorActual) {
            errorPk("detener() se usa dentro de cada(...) { }. Para parar todo usa detenerTodo()");
        }
        detenerTemporizador(temporizadorActual);
        return null;
    },
    detenerTodo: () => detenerTodo()
};

////////////////////////////////////////////////////////////
// READ INSTRUCTIONS
////////////////////////////////////////////////////////////

function leerExpresion() {
    return expresion();
}

function leerBloque() {
    exigir("{");
    const instrucciones = [];

    while (!coincide(actual(), "}") && actual().tipo !== "fin") {
        instrucciones.push(leerInstruccion());
    }

    exigir("}");
    return instrucciones;
}

function leerInstruccion() {
    const linea = actual().linea;
    const nodo = leerInstruccionBase();
    nodo.linea = linea;
    return nodo;
}

function leerInstruccionBase() {
    if (aceptar("crear")) {
        const nombre = leerNombre("Nombre de variable inválido");
        exigir("=");
        return { tipo: "crear", nombre, valor: leerExpresion() };
    }

    // cambiar x = 1   cambiar x += 1   cambiar x++   cambiar lista[0] = 5
    // cambiar caja.texto = "hola"
    if (aceptar("cambiar")) {
        const lineaCambiar = actual().linea;
        const objetivo = primario();
        if (!["identificador", "propiedad", "indice"].includes(objetivo.tipo)) {
            errorPk("Solo puedes cambiar variables, propiedades o posiciones de una lista", lineaCambiar);
        }

        const uno = { tipo: "literal", valor: 1 };
        if (aceptar("++")) return { tipo: "cambiar", objetivo, operador: "+", valor: uno };
        if (aceptar("--")) return { tipo: "cambiar", objetivo, operador: "-", valor: uno };

        for (const op of ["+=", "-=", "*=", "/="]) {
            if (aceptar(op)) {
                return { tipo: "cambiar", objetivo, operador: op[0], valor: leerExpresion() };
            }
        }

        exigir("=");
        return { tipo: "cambiar", objetivo, operador: null, valor: leerExpresion() };
    }

    // nombre = valor  (crea una constante)
    if (actual().tipo === "identificador" && siguienteEs("=")) {
        const nombre = actual().valor;
        posicion++;
        exigir("=");
        return { tipo: "constante", nombre, valor: leerExpresion() };
    }

    if (aceptar("mostrar")) {
        exigir("(");
        return { tipo: "mostrar", valores: leerArgumentos() };
    }

    if (aceptar("retornar")) {
        const sinValor = coincide(actual(), "}") || actual().tipo === "fin";
        return { tipo: "retornar", valor: sinValor ? null : leerExpresion() };
    }

    if (aceptar("funcion")) {
        const nombre = leerNombre("Nombre de función inválido");
        exigir("(");

        const parametros = [];
        if (!aceptar(")")) {
            do {
                parametros.push(leerNombre("Parámetro inválido"));
            } while (aceptar(","));
            exigir(")");
        }

        return { tipo: "funcion", nombre, parametros, cuerpo: leerBloque() };
    }

    if (aceptar("si")) {
        const ramas = [{ condicion: leerExpresion(), cuerpo: leerBloque() }];

        while (aceptar("o")) {
            ramas.push({ condicion: leerExpresion(), cuerpo: leerBloque() });
        }

        const sino = aceptar("sino") ? leerBloque() : null;
        return { tipo: "si", ramas, sino };
    }

    // mientras condicion { ... }
    if (aceptar("mientras")) {
        return { tipo: "mientras", condicion: leerExpresion(), cuerpo: leerBloque() };
    }

    // repetir(5) { ... }   repetir(5, i) { ... }
    if (coincide(actual(), "repetir") && siguienteEs("(")) {
        posicion += 2;
        const veces = leerExpresion();
        const variable = aceptar(",") ? leerNombre("Nombre de variable inválido") : null;
        exigir(")");
        return { tipo: "repetir", veces, variable, cuerpo: leerBloque() };
    }

    // recorrer(lista, item) { ... }
    if (coincide(actual(), "recorrer") && siguienteEs("(")) {
        posicion += 2;
        const lista = leerExpresion();
        exigir(",");
        const variable = leerNombre("Nombre de variable inválido");
        exigir(")");
        return { tipo: "recorrer", lista, variable, cuerpo: leerBloque() };
    }

    if (aceptar("romper")) return { tipo: "romper" };
    if (aceptar("continuar")) return { tipo: "continuar" };

    // para(2) { ... }  -> espera 2 segundos y luego ejecuta
    // cada(1) { ... }  -> ejecuta cada segundo
    for (const palabra of ["para", "cada"]) {
        if (coincide(actual(), palabra) && siguienteEs("(")) {
            posicion += 2;
            const tiempo = leerExpresion();
            exigir(")");
            return { tipo: palabra, tiempo, cuerpo: leerBloque() };
        }
    }

    // cargar { ... }  -> cuando la página cargue
    if (coincide(actual(), "cargar") && siguienteEs("{")) {
        posicion++;
        return { tipo: "cargar", cuerpo: leerBloque() };
    }

    // evento(elemento, "click") { ... }
    if (coincide(actual(), "evento") && siguienteEs("(")) {
        posicion += 2;
        const objetivo = leerExpresion();
        exigir(",");
        const nombre = leerExpresion();
        exigir(")");
        return { tipo: "evento", objetivo, nombre, cuerpo: leerBloque() };
    }

    return { tipo: "expresion", valor: leerExpresion() };
}

////////////////////////////////////////////////////////////
// EXECUTE INSTRUCTIONS
////////////////////////////////////////////////////////////

function ejecutarInstrucciones(instrucciones) {
    for (const instruccion of instrucciones) {
        ejecutarInstruccion(instruccion);
    }
}

// Ejecuta una vuelta de un bucle con su propio ámbito.
// Devuelve "ROMPER" si el código usó romper.
function ejecutarVuelta(cuerpo, variable, valor) {
    ambitos.push({});
    try {
        if (variable) crearVariable(variable, valor, "let");
        ejecutarInstrucciones(cuerpo);
    } catch (error) {
        if (esControl(error) && error.tipo === "ROMPER") return "ROMPER";
        if (esControl(error) && error.tipo === "CONTINUAR") return null;
        throw error;
    } finally {
        ambitos.pop();
    }
    return null;
}

function errorBucle() {
    errorPk(
        "El bucle se repitió más de " + MAX_ITERACIONES +
        " veces. ¿Olvidaste cambiar la condición?"
    );
}

function ejecutarInstruccion(i) {
    try {
        ejecutarNodo(i);
    } catch (error) {
        if (esControl(error)) throw error;
        if (error instanceof PkError) {
            if (error.linea === undefined) error.linea = i.linea;
            throw error;
        }
        throw new PkError(error?.message || String(error), i.linea);
    }
}

function ejecutarNodo(i) {
    switch (i.tipo) {
        case "crear":
            crearVariable(i.nombre, evaluar(i.valor), "let");
            break;

        case "constante":
            crearVariable(i.nombre, evaluar(i.valor), "const");
            break;

        case "cambiar": {
            let valor = evaluar(i.valor);
            if (i.operador) valor = operar(evaluar(i.objetivo), i.operador, valor);
            asignar(i.objetivo, valor);
            break;
        }

        case "mostrar":
            emitir(i.valores.map((v) => formatear(evaluar(v))).join(" "));
            break;

        case "funcion":
            registrarFuncion(i);
            break;

        case "retornar":
            throw { tipo: "RETORNO", valor: evaluar(i.valor) };

        case "romper":
            throw { tipo: "ROMPER" };

        case "continuar":
            throw { tipo: "CONTINUAR" };

        case "si": {
            for (const rama of i.ramas) {
                if (evaluar(rama.condicion)) {
                    ejecutarInstrucciones(rama.cuerpo);
                    return;
                }
            }
            if (i.sino) ejecutarInstrucciones(i.sino);
            break;
        }

        case "mientras": {
            let vueltas = 0;
            while (evaluar(i.condicion)) {
                if (++vueltas > MAX_ITERACIONES) errorBucle();
                if (ejecutarVuelta(i.cuerpo) === "ROMPER") break;
            }
            break;
        }

        case "repetir": {
            const veces = Number(evaluar(i.veces));
            if (!Number.isFinite(veces) || veces < 0) {
                errorPk("repetir necesita un número de veces válido");
            }
            if (veces > MAX_ITERACIONES) errorBucle();
            for (let n = 0; n < veces; n++) {
                if (ejecutarVuelta(i.cuerpo, i.variable, n) === "ROMPER") break;
            }
            break;
        }

        case "recorrer": {
            const origen = evaluar(i.lista);
            if (origen == null || typeof origen[Symbol.iterator] !== "function") {
                errorPk("recorrer necesita una lista, un texto o elementos HTML");
            }
            for (const item of Array.from(origen)) {
                if (ejecutarVuelta(i.cuerpo, i.variable, item) === "ROMPER") break;
            }
            break;
        }

        case "para":
            programar(evaluar(i.tiempo), crearAccion(i.cuerpo), false);
            break;

        case "cada":
            programar(evaluar(i.tiempo), crearAccion(i.cuerpo), true);
            break;

        case "cargar":
            if (cargaIniciada) {
                crearAccion(i.cuerpo)();
            } else {
                bloquesCargar.push({ cadena: ambitos.slice(), cuerpo: i.cuerpo });
            }
            break;

        case "evento":
            registrarEvento(evaluar(i.objetivo), evaluar(i.nombre), i.cuerpo);
            break;

        case "expresion":
            evaluar(i.valor);
            break;
    }
}

////////////////////////////////////////////////////////////
// CALL FUNCTIONS
////////////////////////////////////////////////////////////

function registrarFuncion(i) {
    if (RESERVADAS.has(i.nombre)) {
        errorPk("«" + i.nombre + "» es una palabra reservada de Pk", i.linea);
    }
    memoria.funciones[i.nombre] = i;
}

// Las funciones se pueden usar antes de definirlas
function izarFunciones(instrucciones) {
    for (const i of instrucciones) {
        if (i.tipo === "funcion") registrarFuncion(i);
    }
}

function llamarFuncion(nombre, argumentos) {
    // Si defines una función con el mismo nombre que una integrada, gana la tuya
    if (!tiene(memoria.funciones, nombre)) {
        if (tiene(integradas, nombre)) return integradas[nombre](...argumentos);
        errorPk("Función desconocida: " + nombre);
    }

    const funcion = memoria.funciones[nombre];

    if (profundidad >= MAX_PROFUNDIDAD) {
        errorPk("Demasiadas llamadas anidadas (¿recursión sin fin en «" + nombre + "»?)");
    }

    profundidad++;
    ambitos.push({});

    try {
        funcion.parametros.forEach((parametro, n) => {
            crearVariable(parametro, argumentos[n] ?? null, "let");
        });

        try {
            ejecutarInstrucciones(funcion.cuerpo);
        } catch (error) {
            if (esControl(error) && error.tipo === "RETORNO") return error.valor;
            throw error;
        }

        return null;
    } finally {
        ambitos.pop();
        profundidad--;
    }
}

////////////////////////////////////////////////////////////
// RUN PK
////////////////////////////////////////////////////////////

function ejecutar(codigo) {
    detenerTodo();                 // limpia temporizadores y eventos anteriores
    memoria.funciones = {};
    ambitos = [{}];
    salidaPk = [];
    bloquesCargar = [];
    cargaIniciada = false;
    temporizadorActual = null;
    profundidad = 0;

    try {
        tokensActuales = tokenizar(String(codigo));
        posicion = 0;

        leyendo = true;
        const instrucciones = [];
        while (actual().tipo !== "fin") {
            instrucciones.push(leerInstruccion());
        }
        leyendo = false;

        izarFunciones(instrucciones);
        ejecutarInstrucciones(instrucciones);
        iniciarCarga();
    } catch (error) {
        detenerTodo();             // si algo falla, no dejes cosas a medias
        emitir(mensajeError(error));
    } finally {
        leyendo = false;
    }

    return salidaPk;
}

if (typeof module !== "undefined" && module.exports) module.exports = Pk;
