// assets/js/ruta-mercado.js

// ==============================================================================
// ESTADO GLOBAL
// ==============================================================================
let catalogo = [];
let clientesCache = [];
let metodosPagoCache = [];
let conceptosGastoCache = [];
let almacenesCache = [];
let filasProducto = [];
let pagos = [];
let creditos = [];
let gastos = [];
let rutaActualId = null;
let monedaPrincipal = 'USD';
let monedaSecundaria = 'BS';

function formatearErrorDRF(error, profundidad = 0) {
    if (!error) return 'Error desconocido';
    if (typeof error === 'string') return error;
    if (typeof error !== 'object') return String(error);
    if (error.messageForUser && typeof error.messageForUser === 'string') return error.messageForUser;
    if (error.detail && typeof error.detail === 'string') return error.detail;

    const partes = [];
    for (const [campo, valor] of Object.entries(error)) {
        if (valor === null || valor === undefined) continue;
        if (typeof valor === 'string') {
            partes.push(`${campo}: ${valor}`);
        } else if (Array.isArray(valor)) {
            const msgs = valor.map(v => typeof v === 'string' ? v : formatearErrorDRF(v, profundidad + 1)).filter(Boolean);
            if (msgs.length) partes.push(`${campo}: ${msgs.join(', ')}`);
        } else if (typeof valor === 'object') {
            const nested = formatearErrorDRF(valor, profundidad + 1);
            if (nested) partes.push(`${campo}: {${nested}}`);
        }
    }
    if (partes.length) return partes.join(' | ');
    return JSON.stringify(error);
}

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', function() {
    if (!localStorage.getItem('access_token')) {
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('ruta-fecha').valueAsDate = new Date();
    document.getElementById('nombreUsuario').innerText = 'Admin';
    inicializarRutaMercado();
});

async function inicializarRutaMercado() {
    try {
        const catalogoResp = await apiFetch('/rutas/catalogo/', 'GET');
        catalogo = Array.isArray(catalogoResp) ? catalogoResp : (catalogoResp.results || []);
    } catch (e) {
        console.error('Error cargando catálogo de rutas:', e);
        alert('No se pudo cargar el catálogo de productos. Revisa tu conexión.');
        return;
    }

    const resultados = await Promise.allSettled([
        apiFetch('/pos/datos-iniciales/', 'GET'),
        apiFetch('/egresos/conceptos/', 'GET'),
        apiFetch('/almacenes/', 'GET'),
        apiFetch('/config/tasa-status/', 'GET')
    ]);

    if (resultados[0].status === 'fulfilled') {
        clientesCache = resultados[0].value.clientes || [];
        metodosPagoCache = resultados[0].value.metodos_pago || [];
    } else {
        console.warn('No se cargaron clientes/métodos:', resultados[0].reason);
        clientesCache = []; metodosPagoCache = [];
    }

    if (resultados[1].status === 'fulfilled') {
        conceptosGastoCache = resultados[1].value || [];
    } else {
        console.warn('No se cargaron conceptos:', resultados[1].reason);
        conceptosGastoCache = [];
    }

    if (resultados[2].status === 'fulfilled') {
        almacenesCache = resultados[2].value || [];
    } else {
        console.warn('No se cargaron almacenes:', resultados[2].reason);
        almacenesCache = [{id: 1, nombre: 'Almacén Principal'}];
    }

    if (resultados[3].status === 'fulfilled') {
        const tasa = parseFloat(resultados[3].value.tasa_cambio_actual) || 0;
        monedaPrincipal = resultados[3].value.moneda_principal || 'USD';
        monedaSecundaria = resultados[3].value.moneda_secundaria || 'BS';
        document.getElementById('ruta-tasa').value = tasa.toFixed(2);
        document.getElementById('tasaDisplay').innerText = `Tasa: ${monedaSecundaria} ${tasa.toFixed(2)}`;
    } else {
        console.warn('No se cargó la tasa:', resultados[3].reason);
        document.getElementById('tasaDisplay').innerText = `Tasa: ${monedaSecundaria} ???`;
    }

    llenarSelects();
    actualizarHeadersTabla();
    const cobLabel = document.getElementById('cobranzas-label');
    if (cobLabel) cobLabel.innerText = monedaPrincipal;
    agregarPago();
}

function llenarSelects() {
    const selAlmacen = document.getElementById('ruta-almacen');
    selAlmacen.innerHTML = almacenesCache.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');

    document.getElementById('excel-tipo').addEventListener('change', function() {
        const manual = this.value === 'MANUAL';
        document.getElementById('alerta-seleccion-manual').style.display = manual ? 'block' : 'none';
        if (manual) {
            renderizarGridSeleccionManual();
        }
    });
}

function actualizarHeadersTabla() {
    const thead = document.querySelector('#tablaProductos thead tr');
    if (!thead) return;
    const ths = thead.querySelectorAll('th');
    if (ths.length >= 8) {
        ths[4].innerText = 'Precio ' + monedaSecundaria;
        ths[5].innerText = 'Precio ' + monedaPrincipal;
        ths[6].innerText = 'Total ' + monedaSecundaria;
        ths[7].innerText = 'Total ' + monedaPrincipal;
    }
}

// ==============================================================================
// GENERAR EXCEL
// ==============================================================================
async function generarExcel() {
    const tipo = document.getElementById('excel-tipo').value;
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const incluirPrecio = true;

    let productosIds = [];
    if (tipo === 'MANUAL') {
        productosIds = filasProducto.filter(f => f.presentacion_id).map(f => f.presentacion_id);
        if (productosIds.length === 0) {
            alert('Selecciona productos en el grid primero.');
            return;
        }
    }

    try {
        const resp = await fetch(`${BASE_URL}/rutas/generar-excel/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            },
            body: JSON.stringify({
                tipo: tipo,
                tasa_cambio: tasa,
                incluir_precio_sugerido: incluirPrecio,
                productos_ids: productosIds
            })
        });

        if (!resp.ok) throw new Error('Error al generar Excel');

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ruta_mercado_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// ==============================================================================
// IMPORTAR EXCEL
// ==============================================================================
const dropZone = document.getElementById('dropZone');
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) subirExcel(e.dataTransfer.files[0]);
    });
}

async function subirExcel(file) {
    if (!file) return;
    if (!file.name.endsWith('.xlsx')) {
        alert('Solo se aceptan archivos .xlsx');
        return;
    }

    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;

    const formData = new FormData();
    formData.append('archivo', file);
    formData.append('tasa_cambio', tasa);

    try {
        const resp = await fetch(`${BASE_URL}/rutas/importar-excel/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
            body: formData
        });

        const text = await resp.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('La respuesta del servidor no es válida. ¿Subiste un .xlsx generado por este módulo?');
        }

        if (!resp.ok) throw new Error(data.error || 'Error al importar');

        filasProducto = [];
        (data.detalles || []).forEach(d => {
            filasProducto.push({
                presentacion_id: d.presentacion_id,
                nombre: d.nombre_producto,
                salida: d.cantidad_salida || 0,
                entrada: d.cantidad_entrada || 0,
                precio_bs: d.precio_venta_bs || 0
            });
        });

        renderizarTablaProductos();
        recalcularTodo();

        if (data.no_encontrados && data.no_encontrados.length > 0) {
            console.warn('No encontrados:', data.no_encontrados);
            alert('⚠️ Productos no reconocidos:\n' + data.no_encontrados.join(', ') + '\n\nDebes crearlos en el catálogo primero o escribir el nombre exacto.');
        } else {
            alert('✅ Excel importado correctamente. ' + data.detalles_encontrados + ' productos cargados.');
        }

    } catch (e) {
        const mensaje = formatearErrorDRF(e);
        alert('❌ Error al subir Excel:\n' + mensaje);
        console.error(e);
    }
}

// ==============================================================================
// NAVEGACIÓN TIPO EXCEL EN LA TABLA
// ==============================================================================
function manejarKeydownProducto(e, index) {
    if (e.key === 'Enter') {
        e.preventDefault();
        seleccionarPrimero(index);
    } else {
        navegarTabla(e, index, 'producto');
    }
}

function navegarTabla(e, filaIdx, campo) {
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault();

    const filas = document.querySelectorAll('#tbodyProductos tr');
    if (filaIdx < 0 || filaIdx >= filas.length) return;

    const campoATd = { 'producto': 0, 'salida': 1, 'entrada': 2, 'precio_bs': 4 };
    let tdIdx = campoATd[campo] ?? 1;
    let nextFila = filaIdx;
    let nextTd = tdIdx;

    if (e.key === 'ArrowRight') {
        const orden = [0, 1, 2, 4];
        const pos = orden.indexOf(tdIdx);
        if (pos >= 0 && pos < orden.length - 1) nextTd = orden[pos + 1];
    } else if (e.key === 'ArrowLeft') {
        const orden = [0, 1, 2, 4];
        const pos = orden.indexOf(tdIdx);
        if (pos > 0) nextTd = orden[pos - 1];
    } else if (e.key === 'ArrowDown') {
        nextFila = filaIdx + 1;
    } else if (e.key === 'ArrowUp') {
        nextFila = filaIdx - 1;
    }

    if (nextFila < 0 || nextFila >= filas.length) return;

    const tdDestino = filas[nextFila].children[nextTd];
    if (!tdDestino) return;
    const input = tdDestino.querySelector('input');
    if (input) {
        input.focus();
        input.select();
    }
}

// ==============================================================================
// GRID DE PRODUCTOS
// ==============================================================================
function renderizarTablaProductos() {
    const tbody = document.getElementById('tbodyProductos');
    tbody.innerHTML = '';

    if (filasProducto.length === 0) {
        tbody.innerHTML = `<tr id="fila-vacia"><td colspan="9" class="text-muted text-center py-4">
            <i class="bi bi-inbox fs-2 d-block mb-2"></i>Genera un Excel o añade productos manualmente</td></tr>`;
        return;
    }

    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;

    filasProducto.forEach((fila, index) => {
        const c = calcularFila(fila);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="position:relative;">
                ${fila.presentacion_id ? 
                    `<div class="d-flex align-items-center">
                        <span class="fw-bold flex-grow-1">${fila.nombre}</span>
                        <button class="btn btn-sm btn-link text-danger p-0" onclick="limpiarProductoFila(${index})"><i class="bi bi-x-lg"></i></button>
                     </div>` :
                    `<input type="text" class="form-control form-control-sm" id="buscar-prod-${index}" 
                        placeholder="Escribe nombre o código..." autocomplete="off"
                        oninput="autocompleteProducto(${index}, this.value)"
                        onkeydown="manejarKeydownProducto(event, ${index})"
                        onclick="this.select()">
                     <div class="list-group position-absolute w-100 shadow-sm" id="lista-autocomplete-${index}" style="z-index:1050; max-height:200px; overflow-y:auto; display:none;"></div>`
                }
            </td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.salida}" onchange="actualizarFila(${index}, 'salida', this.value)" onkeydown="navegarTabla(event, ${index}, 'salida')" onclick="this.select()"></td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.entrada}" onchange="actualizarFila(${index}, 'entrada', this.value)" onkeydown="navegarTabla(event, ${index}, 'entrada')" onclick="this.select()"></td>
            <td class="text-center fw-bold text-primary">${c.vendido.toFixed(2)}</td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.precio_bs}" onchange="actualizarFila(${index}, 'precio_bs', this.value)" onkeydown="navegarTabla(event, ${index}, 'precio_bs')" onclick="this.select()"></td>
            <td class="text-center">${c.precioUSD.toFixed(2)}</td>
            <td class="text-center fw-bold">${c.totalBS.toFixed(2)}</td>
            <td class="text-center fw-bold text-success">${c.totalUSD.toFixed(2)}</td>
            <td><button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(${index})"><i class="bi bi-trash"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
}

function autocompleteProducto(index, texto) {
    const lista = document.getElementById(`lista-autocomplete-${index}`);
    if (!lista) return;
    if (!texto || texto.length < 2) { lista.style.display = 'none'; return; }

    const filtrados = catalogo.filter(p => {
        const nom = (p.producto.nombre + ' ' + p.nombre_presentacion).toLowerCase();
        const cod = (p.producto.codigo_base || '').toLowerCase();
        return nom.includes(texto.toLowerCase()) || cod.includes(texto.toLowerCase());
    }).slice(0, 8);

    if (filtrados.length === 0) { lista.style.display = 'none'; return; }

    lista.innerHTML = filtrados.map(p => 
        `<a href="#" class="list-group-item list-group-item-action py-1 px-2 small" 
            onclick="event.preventDefault(); seleccionarProductoAutocomplete(${index}, ${p.id});">
            <strong>${p.producto.nombre}</strong> <span class="text-muted">(${p.nombre_presentacion})</span>
            <span class="float-end text-primary">${monedaSecundaria} ${(p.precio_venta_principal * (parseFloat(document.getElementById('ruta-tasa').value)||0)).toFixed(2)}</span>
        </a>`
    ).join('');
    lista.style.display = 'block';
}

function seleccionarProductoAutocomplete(index, presentacionId) {
    const lista = document.getElementById(`lista-autocomplete-${index}`);
    if (lista) lista.style.display = 'none';
    cambiarProducto(index, presentacionId);
}

function limpiarProductoFila(index) {
    filasProducto[index] = { presentacion_id: null, nombre: '', salida: 0, entrada: 0, precio_bs: 0 };
    renderizarTablaProductos();
}

function seleccionarPrimero(index) {
    const lista = document.getElementById(`lista-autocomplete-${index}`);
    if (lista && lista.style.display !== 'none') {
        const primero = lista.querySelector('a');
        if (primero) primero.click();
    }
}

function calcularFila(fila) {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const salida = parseFloat(fila.salida) || 0;
    const entrada = parseFloat(fila.entrada) || 0;
    const precioBS = parseFloat(fila.precio_bs) || 0;
    const vendido = Math.max(0, salida - entrada);
    const precioUSD = tasa > 0 ? precioBS / tasa : 0;
    const totalBS = vendido * precioBS;
    const totalUSD = vendido * precioUSD;
    return { vendido, precioUSD, totalBS, totalUSD };
}

function actualizarFila(index, campo, valor) {
    filasProducto[index][campo] = valor;
    renderizarTablaProductos();
    recalcularCuadre();
}

function cambiarProducto(index, presentacionId) {
    const pres = catalogo.find(p => p.id == presentacionId);
    if (!pres) return;
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    filasProducto[index] = {
        presentacion_id: pres.id,
        nombre: pres.producto.nombre + ' (' + pres.nombre_presentacion + ')',
        salida: filasProducto[index]?.salida || 0,
        entrada: filasProducto[index]?.entrada || 0,
        precio_bs: tasa > 0 ? parseFloat(pres.precio_venta_principal) * tasa : 0
    };
    renderizarTablaProductos();
    recalcularCuadre();
}

function agregarFilaVacia() {
    const index = filasProducto.length;
    filasProducto.push({ presentacion_id: null, nombre: '', salida: 0, entrada: 0, precio_bs: 0 });
    renderizarTablaProductos();

    setTimeout(() => {
        const input = document.getElementById(`buscar-prod-${index}`);
        if (input) input.focus();
    }, 50);
}

function eliminarFila(index) {
    filasProducto.splice(index, 1);
    renderizarTablaProductos();
    recalcularCuadre();
}

function renderizarGridSeleccionManual() {
    filasProducto = catalogo.map(p => ({
        presentacion_id: p.id,
        nombre: p.producto.nombre + ' (' + p.nombre_presentacion + ')',
        salida: 0, entrada: 0, precio_bs: 0
    }));
    renderizarTablaProductos();
}

// ==============================================================================
// FINANCIERO: PAGOS, CRÉDITOS, GASTOS
// ==============================================================================
function agregarPago() {
    const cont = document.getElementById('contenedor-pagos');
    const idx = pagos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="pago-metodo-${idx}" style="max-width:140px;" onchange="actualizarLabelPago(${idx})">
            ${metodosPagoCache.map(m => `<option value="${m.id}" data-moneda="${m.moneda_referencia}">${m.nombre}</option>`).join('')}
        </select>
        <span class="input-group-text" id="pago-label-${idx}">${monedaSecundaria}</span>
        <input type="number" class="form-control" id="pago-monto-${idx}" step="0.01" placeholder="0.00" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarPago(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    pagos.push({ metodo_id: null, monto_input: 0, moneda: 'SECUNDARIA' });
    setTimeout(() => actualizarLabelPago(idx), 0);
}

function actualizarLabelPago(idx) {
    const select = document.getElementById(`pago-metodo-${idx}`);
    const label = document.getElementById(`pago-label-${idx}`);
    if (!select || !label) return;
    const metodoId = parseInt(select.value);
    const metodo = metodosPagoCache.find(m => m.id === metodoId);
    if (metodo) {
        label.innerText = metodo.moneda_referencia === 'PRINCIPAL' ? monedaPrincipal : monedaSecundaria;
    }
}

function eliminarPago(idx) {
    const cont = document.getElementById('contenedor-pagos');
    if (cont.children[idx]) cont.removeChild(cont.children[idx]);
    pagos.splice(idx, 1);
    recalcularCuadre();
}

function agregarCredito() {
    const cont = document.getElementById('contenedor-creditos');
    const idx = creditos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="credito-cliente-${idx}" style="max-width:140px;">
            ${clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>
        <span class="input-group-text" id="credito-label-${idx}">${monedaPrincipal}</span>
        <input type="number" class="form-control" id="credito-monto-${idx}" step="0.01" placeholder="0.00" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarCredito(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    creditos.push({ cliente_id: null, monto_principal: 0 });
}

function eliminarCredito(idx) {
    const cont = document.getElementById('contenedor-creditos');
    if (cont.children[idx]) cont.removeChild(cont.children[idx]);
    creditos.splice(idx, 1);
    recalcularCuadre();
}

function agregarGasto() {
    const cont = document.getElementById('contenedor-gastos');
    const idx = gastos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="gasto-concepto-${idx}" style="max-width:140px;">
            ${conceptosGastoCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>
        <span class="input-group-text">${monedaSecundaria}</span>
        <input type="number" class="form-control" id="gasto-monto-${idx}" step="0.01" placeholder="0.00" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarGasto(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    gastos.push({ concepto_id: null, monto_bs: 0 });
}

// ==============================================================================
// CUADRE EN TIEMPO REAL
// ==============================================================================
function recalcularTodo() {
    renderizarTablaProductos();
    recalcularCuadre();
}

function recalcularCuadre() {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;

    // ─────────────────────────────────────────
    // 1. VENTA TOTAL (productos vendidos)
    // ─────────────────────────────────────────
    let totalVentaBS = 0;
    let totalVentaUSD = 0;
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        totalVentaBS += c.totalBS;
        totalVentaUSD += c.totalUSD;
    });

    // ─────────────────────────────────────────
    // 2. PAGOS recibidos de clientes
    // ─────────────────────────────────────────
    let totalPagosPrincipal = 0;
    let totalPagosSecundaria = 0;
    const contPagos = document.getElementById('contenedor-pagos');
    Array.from(contPagos.children).forEach((div, idx) => {
        const montoInput = parseFloat(div.querySelector('input[type="number"]').value) || 0;
        const metodoId = parseInt(div.querySelector('select').value);
        const metodo = metodosPagoCache.find(m => m.id === metodoId);
        let montoPrincipal = 0;
        let montoSecundaria = 0;

        if (metodo && metodo.moneda_referencia === 'PRINCIPAL') {
            montoPrincipal = montoInput;
            montoSecundaria = montoInput * tasa;
        } else {
            montoSecundaria = montoInput;
            montoPrincipal = tasa > 0 ? montoInput / tasa : 0;
        }

        pagos[idx] = {
            metodo_id: metodoId,
            monto_input: montoInput,
            moneda: metodo ? metodo.moneda_referencia : 'SECUNDARIA'
        };
        totalPagosPrincipal += montoPrincipal;
        totalPagosSecundaria += montoSecundaria;
    });

    // ─────────────────────────────────────────
    // 3. CRÉDITOS (fiado)
    // ─────────────────────────────────────────
    let totalCreditosPrincipal = 0;
    let totalCreditosSecundaria = 0;
    const contCreditos = document.getElementById('contenedor-creditos');
    Array.from(contCreditos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        creditos[idx] = {
            cliente_id: parseInt(div.querySelector('select').value),
            monto_principal: monto
        };
        totalCreditosPrincipal += monto;
        totalCreditosSecundaria += monto * tasa;
    });

    // ─────────────────────────────────────────
    // 4. GASTOS
    // ─────────────────────────────────────────
    let totalGastosPrincipal = 0;
    let totalGastosSecundaria = 0;
    const contGastos = document.getElementById('contenedor-gastos');
    Array.from(contGastos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        gastos[idx] = {
            concepto_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalGastosPrincipal += tasa > 0 ? monto / tasa : 0;
        totalGastosSecundaria += monto;
    });

    // ─────────────────────────────────────────
    // 5. COBRANZAS (deudas anteriores)
    // ─────────────────────────────────────────
    const cobranzasPrincipal = parseFloat(document.getElementById('cobranzas-principal').value) || 0;
    const cobranzasSecundaria = cobranzasPrincipal * tasa;

    // ═════════════════════════════════════════
    // CUADRE: 3 NÚMEROS SOLAMENTE
    // ═════════════════════════════════════════
    // VENTA          = totalVenta
    // TOTAL RECAUDADO= Pagos + Créditos + Gastos - Cobranzas
    // DIFERENCIA     = Venta - Total Recaudado
    // ═════════════════════════════════════════
    const totalRecaudadoPrincipal = totalPagosPrincipal + totalCreditosPrincipal + totalGastosPrincipal - cobranzasPrincipal;
    const totalRecaudadoSecundaria = totalPagosSecundaria + totalCreditosSecundaria + totalGastosSecundaria - cobranzasSecundaria;

    const diferenciaPrincipal = totalRecaudadoPrincipal - totalVentaUSD;
    const diferenciaSecundaria = totalRecaudadoSecundaria - totalVentaBS;

    // ─────────────────────────────────────────
    // MOSTRAR EN PANTALLA (3 columnas)
    // ─────────────────────────────────────────
    // VENTA
    document.getElementById('cuadre-venta-bs').innerText = monedaSecundaria + ' ' + totalVentaBS.toFixed(2);
    document.getElementById('cuadre-venta-usd').innerText = monedaPrincipal + ' ' + totalVentaUSD.toFixed(2);

    // TOTAL RECAUDADO
    document.getElementById('cuadre-recaudado-bs').innerText = monedaSecundaria + ' ' + totalRecaudadoSecundaria.toFixed(2);
    document.getElementById('cuadre-recaudado-usd').innerText = monedaPrincipal + ' ' + totalRecaudadoPrincipal.toFixed(2);

    // DIFERENCIA
    const elDif = document.getElementById('cuadre-diferencia-bs');
    elDif.innerText = (diferenciaPrincipal >= 0 ? '+ ' : '- ') + monedaPrincipal + ' ' + Math.abs(diferenciaPrincipal).toFixed(2);
    elDif.className = 'mb-0 ' + (Math.abs(diferenciaPrincipal) <= 0.01 ? 'text-success' : (diferenciaPrincipal < 0 ? 'cuadre-negativo' : 'cuadre-positivo'));

    // Alerta visual
    const sticky = document.querySelector('.sticky-cuadre .card-body');
    if (Math.abs(diferenciaPrincipal) <= 0.01) {
        sticky.style.background = '#d1e7dd';
        sticky.style.border = '2px solid #198754';
    } else if (diferenciaPrincipal < 0) {
        sticky.style.background = '#f8d7da';
        sticky.style.border = '2px solid #dc3545';
    } else {
        sticky.style.background = '#fff3cd';
        sticky.style.border = '2px solid #ffc107';
    }
}
// ==============================================================================
// GUARDAR / CERRAR RUTA
// ==============================================================================
function construirPayload() {
    // Sincronizar arrays con el DOM antes de enviar
    recalcularCuadre();

    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const almacenId = parseInt(document.getElementById('ruta-almacen').value) || 1;
    const fecha = document.getElementById('ruta-fecha').value;
    const obs = document.getElementById('ruta-obs').value;

    // CORREGIDO: definir cobranzas correctamente
    const cobranzasPrincipal = parseFloat(document.getElementById('cobranzas-principal').value) || 0;
    const cobranzasBS = cobranzasPrincipal * tasa;

    const detalles = filasProducto
        .filter(f => f.presentacion_id)
        .map(f => ({
            presentacion_id: f.presentacion_id,
            cantidad_salida: parseFloat(f.salida || 0).toFixed(2),
            cantidad_entrada: parseFloat(f.entrada || 0).toFixed(2),
            precio_venta_bs: parseFloat(f.precio_bs || 0).toFixed(2)
        }));

    const pagosPayload = pagos
        .filter(p => p.metodo_id && (p.monto_input > 0 || p.monto_bs > 0))
        .map(p => {
            const metodo = metodosPagoCache.find(m => m.id === p.metodo_id);
            const montoInput = parseFloat(p.monto_input || p.monto_bs || 0);
            let monto_bs, monto_usd;
            if (metodo && metodo.moneda_referencia === 'PRINCIPAL') {
                monto_usd = montoInput.toFixed(2);
                monto_bs = (montoInput * tasa).toFixed(2);
            } else {
                monto_bs = montoInput.toFixed(2);
                monto_usd = tasa > 0 ? (montoInput / tasa).toFixed(2) : '0.00';
            }
            return {
                metodo_id: p.metodo_id,
                monto_bs: monto_bs,
                monto_usd_equivalente: monto_usd,
                referencia: ''
            };
        });

    const creditosPayload = creditos
        .filter(c => c.cliente_id && c.monto_principal > 0)
        .map(c => ({
            cliente_id: c.cliente_id,
            monto_bs: (parseFloat(c.monto_principal) * tasa).toFixed(2),
            descripcion: ''
        }));

    const gastosPayload = gastos
        .filter(g => g.concepto_id && g.monto_bs > 0)
        .map(g => ({
            concepto_id: g.concepto_id,
            monto_bs: parseFloat(g.monto_bs).toFixed(2),
            descripcion: ''
        }));

    return {
        fecha: fecha,
        almacen: almacenId,
        tasa_cambio: tasa.toFixed(2),
        observacion: obs,
        total_cobranzas_bs: cobranzasBS.toFixed(2),
        detalles: detalles,
        pagos: pagosPayload,
        creditos: creditosPayload,
        gastos: gastosPayload
    };
}

async function guardarRuta(estado) {
    let payload;
    try {
        payload = construirPayload();
    } catch (e) {
        console.error('Error construyendo payload:', e);
        alert('Error interno al preparar los datos: ' + e.message);
        return;
    }

    console.log('📦 Payload a enviar:', JSON.stringify(payload, null, 2));
    if (payload.detalles.length === 0) {
        alert('Debes tener al menos un producto.');
        return;
    }

    if (estado === 'CERRADA') {
        const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
        if (tasa <= 0) {
            alert('La tasa debe ser mayor a 0 para cerrar la ruta.');
            return;
        }
    }

    try {
        let resp;
        if (rutaActualId) {
            resp = await apiFetch(`/rutas/${rutaActualId}/`, 'PUT', payload);
        } else {
            resp = await apiFetch('/rutas/', 'POST', payload);
            rutaActualId = resp.id;
        }

        if (estado === 'CERRADA') {
            await cerrarRutaBackend(rutaActualId || resp.id);
        } else {
            alert(`✅ Ruta guardada como BORRADOR. ID: ${resp.id}`);
        }
    } catch (e) {
        console.error('Error guardando (objeto crudo):', JSON.stringify(e, null, 2));
        const mensaje = formatearErrorDRF(e);
        alert('❌ Error al guardar:\n' + mensaje);
    }
}

async function cerrarRuta() {
    if (!confirm('¿Estás seguro de cerrar la ruta? Esto descontará el inventario y generará las deudas. No se puede deshacer fácilmente.')) return;
    await guardarRuta('CERRADA');
}

async function cerrarRutaBackend(id) {
    try {
        const resp = await apiFetch(`/rutas/${id}/cerrar/`, 'POST');
        alert('✅ Ruta cerrada exitosamente. Inventario actualizado y créditos generados.');
        rutaActualId = null;
        resetearFormulario();
    } catch (e) {
        const mensaje = formatearErrorDRF(e);
        alert('❌ Error al cerrar:\n' + mensaje);
    }
}

function resetearFormulario() {
    filasProducto = [];
    pagos = []; creditos = []; gastos = [];
    document.getElementById('contenedor-pagos').innerHTML = '';
    document.getElementById('contenedor-creditos').innerHTML = '';
    document.getElementById('contenedor-gastos').innerHTML = '';
    document.getElementById('cobranzas-principal').value = '0.00';
    document.getElementById('ruta-obs').value = '';
    rutaActualId = null;  // CORREGIDO: evita que el siguiente guardar haga PUT en lugar de POST
    agregarPago();
    renderizarTablaProductos();
    recalcularCuadre();
}

// ==============================================================================
// CARGAR RUTA EXISTENTE (EDITAR BORRADOR / BASE PARA DUPLICAR)
// ==============================================================================
async function cargarRutaExistente(id) {
    try {
        const r = await apiFetch(`/rutas/${id}/`, 'GET');

        // 1. Cambiar a pestaña "Nueva Ruta"
        document.getElementById('tab-nueva').classList.add('active');
        document.getElementById('pane-nueva').classList.add('show', 'active');
        document.getElementById('tab-historial').classList.remove('active');
        document.getElementById('pane-historial').classList.remove('show', 'active');

        // 2. Limpiar estado previo
        filasProducto = [];
        pagos = []; creditos = []; gastos = [];
        document.getElementById('contenedor-pagos').innerHTML = '';
        document.getElementById('contenedor-creditos').innerHTML = '';
        document.getElementById('contenedor-gastos').innerHTML = '';
        // CORREGIDO: ID correcto de cobranzas
        document.getElementById('cobranzas-principal').value = '0.00';
        document.getElementById('ruta-obs').value = '';

        // 3. Setear ID para que guarde con PUT (si es edición)
        rutaActualId = r.id;

        // 4. Datos generales
        const fecha = new Date(r.fecha);
        document.getElementById('ruta-fecha').value = fecha.toISOString().split('T')[0];

        const tasa = parseFloat(r.tasa_cambio || 0);
        document.getElementById('ruta-tasa').value = tasa.toFixed(2);
        document.getElementById('tasaDisplay').innerText = `Tasa: ${monedaSecundaria} ${tasa.toFixed(2)}`;

        if (r.almacen) {
            document.getElementById('ruta-almacen').value = r.almacen;
        }
        document.getElementById('ruta-obs').value = r.observacion || '';

        // 5. Productos
        filasProducto = (r.detalles || []).map(d => ({
            presentacion_id: d.presentacion_id || d.presentacion,
            nombre: d.nombre_producto || d.nombre_presentacion || '',
            salida: parseFloat(d.cantidad_salida) || 0,
            entrada: parseFloat(d.cantidad_entrada) || 0,
            precio_bs: parseFloat(d.precio_venta_bs) || 0
        }));
        renderizarTablaProductos();

        // 6. Pagos
        const pagosData = r.pagos || [];
        if (pagosData.length > 0) {
            pagosData.forEach(p => {
                agregarPago();
                const idx = pagos.length - 1;
                const metodoId = p.metodo_id || (p.metodo && p.metodo.id) || p.metodo;
                const select = document.getElementById(`pago-metodo-${idx}`);
                if (select) select.value = metodoId;

                // CORREGIDO: calcular monto_input según moneda del método
                const metodo = metodosPagoCache.find(m => m.id === parseInt(metodoId));
                let montoInput = 0;
                const montoBs = parseFloat(p.monto_bs || 0);
                if (metodo && metodo.moneda_referencia === 'PRINCIPAL') {
                    montoInput = tasa > 0 ? montoBs / tasa : 0;
                } else {
                    montoInput = montoBs;
                }

                const input = document.getElementById(`pago-monto-${idx}`);
                if (input) input.value = montoInput.toFixed(2);
                pagos[idx] = {
                    metodo_id: parseInt(metodoId) || 0,
                    monto_input: montoInput,
                    moneda: metodo ? metodo.moneda_referencia : 'SECUNDARIA'
                };
            });
        } else {
            agregarPago();
        }

        // 7. Créditos (backend viene en secundaria → convertir a Principal para el input)
        (r.creditos || []).forEach(c => {
            agregarCredito();
            const idx = creditos.length - 1;
            const clienteId = c.cliente_id || (c.cliente && c.cliente.id) || c.cliente;
            const select = document.getElementById(`credito-cliente-${idx}`);
            if (select) select.value = clienteId;

            const montoPrincipal = tasa > 0 ? parseFloat(c.monto_bs || 0) / tasa : 0;
            const input = document.getElementById(`credito-monto-${idx}`);
            if (input) input.value = montoPrincipal.toFixed(2);

            creditos[idx] = {
                cliente_id: parseInt(clienteId) || 0,
                monto_principal: montoPrincipal
            };
        });

        // 8. Gastos
        (r.gastos || []).forEach(g => {
            agregarGasto();
            const idx = gastos.length - 1;
            const conceptoId = g.concepto_id || (g.concepto && g.concepto.id) || g.concepto;
            const select = document.getElementById(`gasto-concepto-${idx}`);
            if (select) select.value = conceptoId;
            const input = document.getElementById(`gasto-monto-${idx}`);
            if (input) input.value = parseFloat(g.monto_bs || 0).toFixed(2);
            gastos[idx] = {
                concepto_id: parseInt(conceptoId) || 0,
                monto_bs: parseFloat(g.monto_bs || 0)
            };
        });

        // 9. Cobranzas (backend viene en secundaria → convertir a Principal para edición)
        const cobranzasPrincipal = tasa > 0 ? parseFloat(r.total_cobranzas_bs || 0) / tasa : 0;
        document.getElementById('cobranzas-principal').value = cobranzasPrincipal.toFixed(2);

        recalcularCuadre();

    } catch (e) {
        const mensaje = formatearErrorDRF(e);
        alert('❌ Error al cargar ruta:\n' + mensaje);
        console.error(e);
    }
}

// ==============================================================================
// HISTORIAL
// ==============================================================================
async function cargarHistorial() {
    const tbody = document.getElementById('tbodyHistorial');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Cargando...</td></tr>';

    try {
        const rutas = await apiFetch('/rutas/', 'GET');
        tbody.innerHTML = '';
        if (rutas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No hay rutas registradas</td></tr>';
            return;
        }

        rutas.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'historial-item';
            const difClass = parseFloat(r.diferencia_bs) < -0.01 ? 'text-danger' : (parseFloat(r.diferencia_bs) > 0.01 ? 'text-success' : 'text-muted');
            tr.innerHTML = `
                <td>${r.id}</td>
                <td>${new Date(r.fecha).toLocaleDateString('es-VE')}</td>
                <td><span class="badge bg-${r.estado === 'CERRADA' ? 'success' : 'warning'}">${r.estado}</span></td>
                <td>${monedaPrincipal} ${parseFloat(r.total_venta_usd || 0).toFixed(2)}</td>
                <td class="${difClass} fw-bold">${monedaSecundaria} ${parseFloat(r.diferencia_bs || 0).toFixed(2)}</td>
                <td>${r.usuario_nombre || 'Admin'}</td>
                <td>
                    <button class="btn btn-sm btn-primary me-1" onclick="verRuta(${r.id})" title="Ver"><i class="bi bi-eye"></i></button>
                    ${r.estado === 'BORRADOR' ? `<button class="btn btn-sm btn-warning" onclick="cargarRutaExistente(${r.id})" title="Editar"><i class="bi bi-pencil"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Error al cargar historial</td></tr>';
    }
}

let rutaEnVista = null;
async function verRuta(id) {
    try {
        const r = await apiFetch(`/rutas/${id}/`, 'GET');
        rutaEnVista = r;
        document.getElementById('ver-ruta-id').innerText = r.id;
        const modal = new bootstrap.Modal(document.getElementById('modalVerRuta'));

        const btnReabrir = document.getElementById('btn-reabrir-ruta');
        btnReabrir.style.display = r.estado === 'CERRADA' ? 'inline-block' : 'none';

        let html = `
            <div class="row mb-3">
                <div class="col-md-6"><strong>Fecha:</strong> ${new Date(r.fecha).toLocaleDateString('es-VE')}</div>
                <div class="col-md-6"><strong>Estado:</strong> <span class="badge bg-${r.estado === 'CERRADA' ? 'success' : 'warning'}">${r.estado}</span></div>
                <div class="col-md-6"><strong>Tasa:</strong> ${monedaSecundaria} ${parseFloat(r.tasa_cambio).toFixed(2)}</div>
                <div class="col-md-6"><strong>Observación:</strong> ${r.observacion || 'N/A'}</div>
            </div>
            <h6 class="fw-bold">Productos</h6>
            <table class="table table-sm table-bordered">
                <thead class="table-light"><tr><th>Producto</th><th>Salida</th><th>Entrada</th><th>Vendido</th><th>Precio ${monedaSecundaria}</th><th>Total ${monedaPrincipal}</th></tr></thead>
                <tbody>
                    ${(r.detalles || []).map(d => `
                        <tr>
                            <td>${d.nombre_producto || d.nombre_presentacion}</td>
                            <td>${d.cantidad_salida}</td>
                            <td>${d.cantidad_entrada}</td>
                            <td class="fw-bold text-primary">${d.cantidad_vendida}</td>
                            <td>${d.precio_venta_bs}</td>
                            <td class="fw-bold text-success">${parseFloat(d.subtotal_usd || 0).toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="row">
                <div class="col-md-4">
                    <h6 class="fw-bold text-success">Pagos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.pagos || []).map(p => `<li class="list-group-item py-1">${p.metodo_nombre}: ${monedaSecundaria} ${p.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin pagos</li>'}
                    </ul>
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold text-warning">Créditos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.creditos || []).map(c => `<li class="list-group-item py-1">${c.cliente_nombre}: ${monedaSecundaria} ${c.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin créditos</li>'}
                    </ul>
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold text-danger">Gastos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.gastos || []).map(g => `<li class="list-group-item py-1">${g.concepto_nombre}: ${monedaSecundaria} ${g.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin gastos</li>'}
                    </ul>
                </div>
            </div>
            <hr>
            <div class="row text-center fw-bold">
                <div class="col">Venta: ${monedaSecundaria} ${parseFloat(r.total_venta_bs).toFixed(2)}</div>
                <div class="col">Recaudado: ${monedaSecundaria} ${parseFloat(r.recaudado_real_bs).toFixed(2)}</div>
                <div class="col ${parseFloat(r.diferencia_bs) < 0 ? 'text-danger' : 'text-success'}">Dif: ${monedaSecundaria} ${parseFloat(r.diferencia_bs).toFixed(2)}</div>
            </div>
        `;
        document.getElementById('ver-ruta-contenido').innerHTML = html;
        modal.show();
    } catch (e) {
        alert('Error al cargar ruta: ' + e.message);
    }
}

async function reabrirRutaActual() {
    if (!rutaEnVista) return;
    if (!confirm('¿Reabrir esta ruta? Se revertirá el inventario y se eliminarán las deudas generadas (si no tienen pagos).')) return;

    try {
        await apiFetch(`/rutas/${rutaEnVista.id}/reabrir/`, 'POST');
        alert('Ruta reabierta correctamente.');
        bootstrap.Modal.getInstance(document.getElementById('modalVerRuta')).hide();
        cargarHistorial();
    } catch (e) {
        alert('Error: ' + (e.error || e.detail || 'No se pudo reabrir'));
    }
}

// ==============================================================================
// ATAJOS DE TECLADO
// ==============================================================================
document.addEventListener('keydown', function(e) {
    if (e.key === 'F2') {
        e.preventDefault();
        guardarRuta('BORRADOR');
    }
    if (e.key === 'F9') {
        e.preventDefault();
        cerrarRuta();
    }
    if (e.key === 'Escape') {
        if (filasProducto.length > 0 && confirm('¿Cancelar todo y empezar de nuevo?')) {
            resetearFormulario();
        }
    }
    if (e.ctrlKey && e.key === 'p') {
        e.preventDefault();
        imprimirResumenRuta();
    }
});

function imprimirResumenRuta() {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const ticket = document.getElementById('ticket-ruta-impresion');
    ticket.classList.remove('activo');

    document.getElementById('r-ticket-id').innerText = rutaActualId || 'BORRADOR';
    document.getElementById('r-ticket-fecha').innerText = new Date().toLocaleString('es-VE');
    document.getElementById('r-ticket-tasa').innerText = tasa.toFixed(2);
    document.getElementById('r-ticket-obs').innerText = document.getElementById('ruta-obs').value || 'N/A';

    // Productos
    const tbody = document.getElementById('r-ticket-items');
    tbody.innerHTML = '';
    let totalVentaBS = 0;
    let totalVentaUSD = 0;
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        if (c.vendido <= 0) return;
        totalVentaBS += c.totalBS;
        totalVentaUSD += c.totalUSD;
        const row = document.createElement('tr');
        row.innerHTML = `<td style="text-align:center;">${c.vendido.toFixed(2)}</td><td>${f.nombre}</td><td style="text-align:right;">${monedaSecundaria} ${c.totalBS.toFixed(2)}</td>`;
        tbody.appendChild(row);
    });

    document.getElementById('r-ticket-venta-bs').innerText = totalVentaBS.toFixed(2);
    document.getElementById('r-ticket-venta-usd').innerText = totalVentaUSD.toFixed(2);

    // Pagos desglosados
    let efectivo = 0, movil = 0, punto = 0;
    let totalPagosPrincipal = 0;
    const contPagos = document.getElementById('contenedor-pagos');
    Array.from(contPagos.children).forEach((div) => {
        const montoInput = parseFloat(div.querySelector('input[type="number"]').value) || 0;
        const metodoId = parseInt(div.querySelector('select').value);
        const metodo = metodosPagoCache.find(m => m.id === metodoId);
        let montoPrincipal = 0;
        if (metodo && metodo.moneda_referencia === 'PRINCIPAL') {
            montoPrincipal = montoInput;
        } else {
            montoPrincipal = tasa > 0 ? montoInput / tasa : 0;
        }
        const nombre = metodo ? metodo.nombre.toLowerCase() : '';
        if (nombre.includes('efectivo')) efectivo += montoPrincipal;
        else if (nombre.includes('movil')) movil += montoPrincipal;
        else if (nombre.includes('punto') || nombre.includes('data')) punto += montoPrincipal;
        totalPagosPrincipal += montoPrincipal;
    });

    document.getElementById('r-ticket-efectivo').innerText = efectivo.toFixed(2);
    document.getElementById('r-ticket-movil').innerText = movil.toFixed(2);
    document.getElementById('r-ticket-punto').innerText = punto.toFixed(2);

    // Créditos
    const totalCreditosPrincipal = creditos.reduce((s, c) => s + (c.monto_principal || 0), 0);
    document.getElementById('r-ticket-creditos').innerText = totalCreditosPrincipal.toFixed(2);

    // Gastos
    const totalGastosSec = gastos.reduce((s, g) => s + (g.monto_bs || 0), 0);
    document.getElementById('r-ticket-gastos').innerText = totalGastosSec.toFixed(2);

    // Cobranzas
    const cobranzasPrincipal = parseFloat(document.getElementById('cobranzas-principal').value) || 0;
    document.getElementById('r-ticket-cobranzas').innerText = cobranzasPrincipal.toFixed(2);

    // TOTAL RECAUDADO = Pagos + Créditos + Gastos - Cobranzas
    const totalGastosPrincipal = gastos.reduce((s, g) => s + (tasa > 0 ? (g.monto_bs || 0) / tasa : 0), 0);
    const totalRecaudado = totalPagosPrincipal + totalCreditosPrincipal + totalGastosPrincipal - cobranzasPrincipal;
    document.getElementById('r-ticket-recaudado').innerText = totalRecaudado.toFixed(2);

    // DIFERENCIA = Venta - Total Recaudado
    const dif = totalRecaudado - totalVentaUSD;
    const elDif = document.getElementById('r-ticket-diferencia');
    elDif.innerText = (dif >= 0 ? '+ ' : '- ') + monedaPrincipal + ' ' + Math.abs(dif).toFixed(2);
    elDif.style.color = dif < -0.01 ? '#dc3545' : (dif > 0.01 ? '#198754' : '#000');

    ticket.classList.add('activo');
    setTimeout(() => { window.print(); setTimeout(() => ticket.classList.remove('activo'), 500); }, 100);
}
async function duplicarUltimaRuta() {
    try {
        const rutas = await apiFetch('/rutas/', 'GET');
        if (!rutas || rutas.length === 0) {
            alert('No hay rutas anteriores para duplicar.');
            return;
        }
        const ultima = rutas[0];
        await cargarRutaExistente(ultima.id);
        rutaActualId = null;
        document.getElementById('contenedor-pagos').innerHTML = '';
        document.getElementById('contenedor-creditos').innerHTML = '';
        document.getElementById('contenedor-gastos').innerHTML = '';
        // CORREGIDO: ID correcto
        document.getElementById('cobranzas-principal').value = '0.00';
        pagos = []; creditos = []; gastos = [];
        agregarPago();
        recalcularCuadre();
        alert('Ruta duplicada como base. Ajusta las cantidades y cierra cuando esté listo.');
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function exportarCuadreExcel() {
    let csv = `PRODUCTO,SALIDA,ENTRADA,VENDIDO,PRECIO ${monedaSecundaria},TOTAL ${monedaSecundaria},TOTAL ${monedaPrincipal}
`;
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        if (c.vendido > 0) {
            csv += `"${f.nombre}",${f.salida},${f.entrada},${c.vendido.toFixed(2)},${f.precio_bs},${c.totalBS.toFixed(2)},${c.totalUSD.toFixed(2)}
`;
        }
    });
    csv += `
RESUMEN,,,,,,
`;
    csv += `VENTA TOTAL,,,,,${document.getElementById('cuadre-venta-bs').innerText},${document.getElementById('cuadre-venta-usd').innerText}
`;
    csv += `TOTAL RECAUDADO,,,,,${document.getElementById('cuadre-recaudado-bs').innerText},${document.getElementById('cuadre-recaudado-usd').innerText}
`;
    csv += `DIFERENCIA,,,,,${document.getElementById('cuadre-diferencia-bs').innerText},
`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cuadre_ruta_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function cerrarSesionLocal() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = 'index.html';
}
