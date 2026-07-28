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
            // Puede ser array de strings u objetos (errores nested de DRF)
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
// INICIALIZACI”N
// ==============================================================================
document.addEventListener('DOMContentLoaded', function() {
    if (!localStorage.getItem('access_token')) {
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('ruta-fecha').valueAsDate = new Date();
    document.getElementById('nombreUsuario').innerText = 'Admin'; // Se actualiza luego
    inicializarRutaMercado();
});

async function inicializarRutaMercado() {
    // 1. Cat√°logo de rutas (NO depende de caja abierta)
    try {
        const catalogoResp = await apiFetch('/rutas/catalogo/', 'GET');
        catalogo = Array.isArray(catalogoResp) ? catalogoResp : (catalogoResp.results || []);
    } catch (e) {
        console.error('Error cargando cat√°logo de rutas:', e);
        alert('No se pudo cargar el cat√°logo de productos. Revisa tu conexi√≥n.');
        return; // Sin cat√°logo no podemos operar
    }

    // 2. Datos auxiliares en paralelo pero sin bloquearse entre s√≠
    const resultados = await Promise.allSettled([
        apiFetch('/pos/datos-iniciales/', 'GET'),
        apiFetch('/egresos/conceptos/', 'GET'),
        apiFetch('/almacenes/', 'GET'),
        apiFetch('/config/tasa-status/', 'GET')
    ]);

    // Clientes + m√©todos de pago
    if (resultados[0].status === 'fulfilled') {
        clientesCache = resultados[0].value.clientes || [];
        metodosPagoCache = resultados[0].value.metodos_pago || [];
    } else {
        console.warn('No se cargaron clientes/m√©todos:', resultados[0].reason);
        clientesCache = []; metodosPagoCache = [];
    }

    // Conceptos de gasto
    if (resultados[1].status === 'fulfilled') {
        conceptosGastoCache = resultados[1].value || [];
    } else {
        console.warn('No se cargaron conceptos:', resultados[1].reason);
        conceptosGastoCache = [];
    }

    // Almacenes
    if (resultados[2].status === 'fulfilled') {
        almacenesCache = resultados[2].value || [];
    } else {
        console.warn('No se cargaron almacenes:', resultados[2].reason);
        almacenesCache = [{id: 1, nombre: 'Almac√©n Principal'}];
    }

    // Tasa de cambio
    if (resultados[3].status === 'fulfilled') {
        const tasa = parseFloat(resultados[3].value.tasa_cambio_actual) || 0;
        document.getElementById('ruta-tasa').value = tasa.toFixed(2);
        document.getElementById('tasaDisplay').innerText = 'Tasa: BS ' + tasa.toFixed(2);
    } else {
        console.warn('No se carg√≥ la tasa:', resultados[3].reason);
        document.getElementById('tasaDisplay').innerText = 'Tasa: BS ???';
    }

    llenarSelects();
    agregarPago(); // l√≠nea de pago por defecto
}
function llenarSelects() {
    // AlmacÈn
    const selAlmacen = document.getElementById('ruta-almacen');
    selAlmacen.innerHTML = almacenesCache.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');

    // Tipo Excel
    document.getElementById('excel-tipo').addEventListener('change', function() {
        const manual = this.value === 'MANUAL';
        document.getElementById('alerta-seleccion-manual').style.display = manual ? 'block' : 'none';
        if (manual) {
            // Si elige manual, mostramos todos los productos en el grid para que seleccione
            renderizarGridSeleccionManual();
        }
    });
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
            throw new Error('La respuesta del servidor no es v·lida. øSubiste un .xlsx generado por este mÛdulo?');
        }

        if (!resp.ok) throw new Error(data.error || 'Error al importar');

        // Limpiar y rellenar
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
            alert('?? Productos no reconocidos:\n' + data.no_encontrados.join(', ') + '\n\nDebes crearlos en el cat·logo primero o escribir el nombre exacto.');
        } else {
            alert('? Excel importado correctamente. ' + data.detalles_encontrados + ' productos cargados.');
        }

    } catch (e) {
        const mensaje = formatearErrorDRF(e);
        alert('‚ùå Error al subir Excel:\n' + mensaje);
        console.error(e);
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
            <i class="bi bi-inbox fs-2 d-block mb-2"></i>Genera un Excel o aÒade productos manualmente</td></tr>`;
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
                        placeholder="Escribe nombre o cÛdigo..." autocomplete="off"
                        oninput="autocompleteProducto(${index}, this.value)"
                        onkeydown="if(event.key==='Enter'){event.preventDefault();seleccionarPrimero(${index});}">
                     <div class="list-group position-absolute w-100 shadow-sm" id="lista-autocomplete-${index}" style="z-index:1050; max-height:200px; overflow-y:auto; display:none;"></div>`
                }
            </td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.salida}" onchange="actualizarFila(${index}, 'salida', this.value)"></td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.entrada}" onchange="actualizarFila(${index}, 'entrada', this.value)"></td>
            <td class="text-center fw-bold text-primary">${c.vendido.toFixed(2)}</td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.precio_bs}" onchange="actualizarFila(${index}, 'precio_bs', this.value)"></td>
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
    }).slice(0, 8); // m·ximo 8 resultados
    
    if (filtrados.length === 0) { lista.style.display = 'none'; return; }
    
    lista.innerHTML = filtrados.map(p => 
        `<a href="#" class="list-group-item list-group-item-action py-1 px-2 small" 
            onclick="event.preventDefault(); seleccionarProductoAutocomplete(${index}, ${p.id});">
            <strong>${p.producto.nombre}</strong> <span class="text-muted">(${p.nombre_presentacion})</span>
            <span class="float-end text-primary">BS ${(p.precio_venta_principal * (parseFloat(document.getElementById('ruta-tasa').value)||0)).toFixed(2)}</span>
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
    
    // Focus en el input de b˙squeda de la nueva fila
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
    // Muestra todos los productos para que el usuario seleccione cu·les quiere en el Excel
    filasProducto = catalogo.map(p => ({
        presentacion_id: p.id,
        nombre: p.producto.nombre + ' (' + p.nombre_presentacion + ')',
        salida: 0, entrada: 0, precio_bs: 0
    }));
    renderizarTablaProductos();
}

// ==============================================================================
// FINANCIERO: PAGOS, CR…DITOS, GASTOS
// ==============================================================================
function agregarPago() {
    const cont = document.getElementById('contenedor-pagos');
    const idx = pagos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="pago-metodo-${idx}" style="max-width:140px;">
            ${metodosPagoCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}
        </select>
        <input type="number" class="form-control" id="pago-monto-${idx}" step="0.01" placeholder="BS" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarPago(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    pagos.push({ metodo_id: null, monto_bs: 0 });
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
        <input type="number" class="form-control" id="credito-monto-${idx}" step="0.01" placeholder="BS" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarCredito(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    creditos.push({ cliente_id: null, monto_bs: 0 });
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
        <input type="number" class="form-control" id="gasto-monto-${idx}" step="0.01" placeholder="BS" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarGasto(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    gastos.push({ concepto_id: null, monto_bs: 0 });
}

function eliminarGasto(idx) {
    const cont = document.getElementById('contenedor-gastos');
    if (cont.children[idx]) cont.removeChild(cont.children[idx]);
    gastos.splice(idx, 1);
    recalcularCuadre();
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

    // Productos
    let totalVentaBS = 0;
    let totalVentaUSD = 0;
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        totalVentaBS += c.totalBS;
        totalVentaUSD += c.totalUSD;
    });

    // Pagos
    let totalPagosBS = 0;
    const contPagos = document.getElementById('contenedor-pagos');
    Array.from(contPagos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        pagos[idx] = {
            metodo_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalPagosBS += monto;
    });

    // CrÈditos
    let totalCreditosBS = 0;
    const contCreditos = document.getElementById('contenedor-creditos');
    Array.from(contCreditos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        creditos[idx] = {
            cliente_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalCreditosBS += monto;
    });

    // Gastos
    let totalGastosBS = 0;
    const contGastos = document.getElementById('contenedor-gastos');
    Array.from(contGastos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        gastos[idx] = {
            concepto_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalGastosBS += monto;
    });

    // Cobranzas
    const cobranzasBS = parseFloat(document.getElementById('cobranzas-bs').value) || 0;

    // Cuadre
    const esperadoBS = totalVentaBS - totalCreditosBS - totalGastosBS + cobranzasBS;
    const realBS = totalPagosBS + cobranzasBS;
    const diferenciaBS = realBS - esperadoBS;

    // Mostrar
    document.getElementById('cuadre-venta-bs').innerText = 'BS ' + totalVentaBS.toFixed(2);
    document.getElementById('cuadre-venta-usd').innerText = '$ ' + totalVentaUSD.toFixed(2);
    document.getElementById('cuadre-esperado-bs').innerText = 'BS ' + esperadoBS.toFixed(2);
    document.getElementById('cuadre-real-bs').innerText = 'BS ' + realBS.toFixed(2);

    const elDif = document.getElementById('cuadre-diferencia-bs');
    elDif.innerText = (diferenciaBS >= 0 ? '+ ' : '- ') + 'BS ' + Math.abs(diferenciaBS).toFixed(2);
    elDif.className = 'mb-0 ' + (Math.abs(diferenciaBS) <= 0.01 ? 'text-success' : (diferenciaBS < 0 ? 'cuadre-negativo' : 'cuadre-positivo'));

    // Alerta visual en el panel sticky
    const sticky = document.querySelector('.sticky-cuadre .card-body');
    if (Math.abs(diferenciaBS) <= 0.01) {
        sticky.style.background = '#d1e7dd'; // verde claro
        sticky.style.border = '2px solid #198754';
    } else if (diferenciaBS < 0) {
        sticky.style.background = '#f8d7da'; // rojo claro
        sticky.style.border = '2px solid #dc3545';
    } else {
        sticky.style.background = '#fff3cd'; // amarillo (sobrante)
        sticky.style.border = '2px solid #ffc107';
    }
}

// ==============================================================================
// GUARDAR / CERRAR RUTA
// ==============================================================================
function construirPayload() {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const almacenId = parseInt(document.getElementById('ruta-almacen').value) || 1;
    const fecha = document.getElementById('ruta-fecha').value;
    const obs = document.getElementById('ruta-obs').value;

    // Filtrar filas v·lidas
    const detalles = filasProducto
        .filter(f => f.presentacion_id)
        .map(f => ({
            presentacion_id: f.presentacion_id,
            cantidad_salida: parseFloat(f.salida || 0).toFixed(2),
            cantidad_entrada: parseFloat(f.entrada || 0).toFixed(2),
            precio_venta_bs: parseFloat(f.precio_bs || 0).toFixed(2)
        }));

    const pagosPayload = pagos
        .filter(p => p.metodo_id && p.monto_bs > 0)
        .map(p => ({
            metodo_id: p.metodo_id,
            monto_bs: parseFloat(p.monto_bs).toFixed(2),
            monto_usd_equivalente: tasa > 0 ? (p.monto_bs / tasa).toFixed(2) : '0.00',
            referencia: ''
        }));

    const creditosPayload = creditos
        .filter(c => c.cliente_id && c.monto_bs > 0)
        .map(c => ({
            cliente_id: c.cliente_id,
            monto_bs: parseFloat(c.monto_bs).toFixed(2),
            descripcion: ''
        }));

    const gastosPayload = gastos
        .filter(g => g.concepto_id && g.monto_bs > 0)
        .map(g => ({
            concepto_id: g.concepto_id,
            monto_bs: parseFloat(g.monto_bs).toFixed(2),
            descripcion: ''
        }));

    const cobranzasBS = parseFloat(document.getElementById('cobranzas-bs').value) || 0;

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
    const payload = construirPayload();
    console.log('üì¶ Payload a enviar:', JSON.stringify(payload, null, 2));
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
            alert(`‚úÖ Ruta guardada como BORRADOR. ID: ${resp.id}`);
        }
    } catch (e) {
        console.error('Error guardando (objeto crudo):', JSON.stringify(e, null, 2));
        const mensaje = formatearErrorDRF(e);
        alert('‚ùå Error al guardar:\n' + mensaje);
    }
}

async function cerrarRuta() {
    if (!confirm('øEst·s seguro de cerrar la ruta? Esto descontar· el inventario y generar· las deudas. No se puede deshacer f·cilmente.')) return;
    await guardarRuta('CERRADA');
}

async function cerrarRutaBackend(id) {
    try {
        const resp = await apiFetch(`/rutas/${id}/cerrar/`, 'POST');
        alert('‚úÖ Ruta cerrada exitosamente. Inventario actualizado y cr√©ditos generados.');
        rutaActualId = null;
        resetearFormulario();
    } catch (e) {
        const mensaje = formatearErrorDRF(e);
        alert('‚ùå Error al cerrar:\n' + mensaje);
    }
}

function resetearFormulario() {
    filasProducto = [];
    pagos = []; creditos = []; gastos = [];
    document.getElementById('contenedor-pagos').innerHTML = '';
    document.getElementById('contenedor-creditos').innerHTML = '';
    document.getElementById('contenedor-gastos').innerHTML = '';
    document.getElementById('cobranzas-bs').value = '0.00';
    document.getElementById('ruta-obs').value = '';
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

        // 1. Cambiar a pesta√±a "Nueva Ruta"
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
        document.getElementById('cobranzas-bs').value = '0.00';
        document.getElementById('ruta-obs').value = '';

        // 3. Setear ID para que guarde con PUT (si es edici√≥n)
        rutaActualId = r.id;

        // 4. Datos generales
        const fecha = new Date(r.fecha);
        document.getElementById('ruta-fecha').value = fecha.toISOString().split('T')[0];

        const tasa = parseFloat(r.tasa_cambio || 0);
        document.getElementById('ruta-tasa').value = tasa.toFixed(2);
        document.getElementById('tasaDisplay').innerText = 'Tasa: BS ' + tasa.toFixed(2);

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
                const input = document.getElementById(`pago-monto-${idx}`);
                if (input) input.value = parseFloat(p.monto_bs || 0).toFixed(2);
                pagos[idx] = {
                    metodo_id: parseInt(metodoId) || 0,
                    monto_bs: parseFloat(p.monto_bs || 0)
                };
            });
        } else {
            agregarPago(); // al menos uno vac√≠o
        }

        // 7. Cr√©ditos
        (r.creditos || []).forEach(c => {
            agregarCredito();
            const idx = creditos.length - 1;
            const clienteId = c.cliente_id || (c.cliente && c.cliente.id) || c.cliente;
            const select = document.getElementById(`credito-cliente-${idx}`);
            if (select) select.value = clienteId;
            const input = document.getElementById(`credito-monto-${idx}`);
            if (input) input.value = parseFloat(c.monto_bs || 0).toFixed(2);
            creditos[idx] = {
                cliente_id: parseInt(clienteId) || 0,
                monto_bs: parseFloat(c.monto_bs || 0)
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

        // 9. Cobranzas
        document.getElementById('cobranzas-bs').value = parseFloat(r.total_cobranzas_bs || 0).toFixed(2);

        recalcularCuadre();

    } catch (e) {
        const mensaje = formatearErrorDRF(e);
        alert('‚ùå Error al cargar ruta:\n' + mensaje);
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
                <td>$ ${parseFloat(r.total_venta_usd || 0).toFixed(2)}</td>
                <td class="${difClass} fw-bold">BS ${parseFloat(r.diferencia_bs || 0).toFixed(2)}</td>
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
        
        // Mostrar/ocultar botÛn reabrir seg˙n rol/estado
        const btnReabrir = document.getElementById('btn-reabrir-ruta');
        btnReabrir.style.display = r.estado === 'CERRADA' ? 'inline-block' : 'none';

        // Construir HTML del detalle
        let html = `
            <div class="row mb-3">
                <div class="col-md-6"><strong>Fecha:</strong> ${new Date(r.fecha).toLocaleDateString('es-VE')}</div>
                <div class="col-md-6"><strong>Estado:</strong> <span class="badge bg-${r.estado === 'CERRADA' ? 'success' : 'warning'}">${r.estado}</span></div>
                <div class="col-md-6"><strong>Tasa:</strong> BS ${parseFloat(r.tasa_cambio).toFixed(2)}</div>
                <div class="col-md-6"><strong>ObservaciÛn:</strong> ${r.observacion || 'N/A'}</div>
            </div>
            <h6 class="fw-bold">Productos</h6>
            <table class="table table-sm table-bordered">
                <thead class="table-light"><tr><th>Producto</th><th>Salida</th><th>Entrada</th><th>Vendido</th><th>Precio BS</th><th>Total $</th></tr></thead>
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
                        ${(r.pagos || []).map(p => `<li class="list-group-item py-1">${p.metodo_nombre}: BS ${p.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin pagos</li>'}
                    </ul>
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold text-warning">CrÈditos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.creditos || []).map(c => `<li class="list-group-item py-1">${c.cliente_nombre}: BS ${c.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin crÈditos</li>'}
                    </ul>
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold text-danger">Gastos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.gastos || []).map(g => `<li class="list-group-item py-1">${g.concepto_nombre}: BS ${g.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin gastos</li>'}
                    </ul>
                </div>
            </div>
            <hr>
            <div class="row text-center fw-bold">
                <div class="col">Venta: BS ${parseFloat(r.total_venta_bs).toFixed(2)}</div>
                <div class="col">Esperado: BS ${parseFloat(r.recaudado_esperado_bs).toFixed(2)}</div>
                <div class="col">Real: BS ${parseFloat(r.recaudado_real_bs).toFixed(2)}</div>
                <div class="col ${parseFloat(r.diferencia_bs) < 0 ? 'text-danger' : 'text-success'}">Dif: BS ${parseFloat(r.diferencia_bs).toFixed(2)}</div>
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
    if (!confirm('øReabrir esta ruta? Se revertir· el inventario y se eliminar·n las deudas generadas (si no tienen pagos).')) return;

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
    // F2 = Guardar borrador
    if (e.key === 'F2') {
        e.preventDefault();
        guardarRuta('BORRADOR');
    }
    // F9 = Cerrar ruta
    if (e.key === 'F9') {
        e.preventDefault();
        cerrarRuta();
    }
    // ESC = Cancelar / Vaciar todo (con confirmaciÛn)
    if (e.key === 'Escape') {
        if (filasProducto.length > 0 && confirm('øCancelar todo y empezar de nuevo?')) {
            resetearFormulario();
        }
    }
    // Ctrl + P = Imprimir resumen de ruta
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
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        if (c.vendido <= 0) return;
        const row = document.createElement('tr');
        row.innerHTML = `<td style="text-align:center;">${c.vendido.toFixed(2)}</td><td>${f.nombre}</td><td style="text-align:right;">BS ${c.totalBS.toFixed(2)}</td>`;
        tbody.appendChild(row);
    });

    // Totales
    const ventaBS = parseFloat(document.getElementById('cuadre-venta-bs').innerText.replace('BS ', '')) || 0;
    const ventaUSD = parseFloat(document.getElementById('cuadre-venta-usd').innerText.replace('$ ', '')) || 0;
    const esperado = parseFloat(document.getElementById('cuadre-esperado-bs').innerText.replace('BS ', '')) || 0;
    const real = parseFloat(document.getElementById('cuadre-real-bs').innerText.replace('BS ', '')) || 0;
    const dif = parseFloat(document.getElementById('cuadre-diferencia-bs').innerText.replace(/[BS +\-]/g, '')) || 0;

    document.getElementById('r-ticket-venta-bs').innerText = ventaBS.toFixed(2);
    document.getElementById('r-ticket-venta-usd').innerText = ventaUSD.toFixed(2);

    // Pagos desglosados
    let efectivo = 0, movil = 0, punto = 0;
    pagos.forEach(p => {
        const met = metodosPagoCache.find(m => m.id == p.metodo_id);
        const nombre = met ? met.nombre.toLowerCase() : '';
        if (nombre.includes('efectivo')) efectivo += p.monto_bs;
        else if (nombre.includes('movil')) movil += p.monto_bs;
        else if (nombre.includes('punto') || nombre.includes('data')) punto += p.monto_bs;
    });

    document.getElementById('r-ticket-efectivo').innerText = efectivo.toFixed(2);
    document.getElementById('r-ticket-movil').innerText = movil.toFixed(2);
    document.getElementById('r-ticket-punto').innerText = punto.toFixed(2);

    const cobranzas = parseFloat(document.getElementById('cobranzas-bs').value) || 0;
    document.getElementById('r-ticket-cobranzas').innerText = cobranzas.toFixed(2);

    const totalCreditos = creditos.reduce((s, c) => s + c.monto_bs, 0);
    const totalGastos = gastos.reduce((s, g) => s + g.monto_bs, 0);
    document.getElementById('r-ticket-creditos').innerText = totalCreditos.toFixed(2);
    document.getElementById('r-ticket-gastos').innerText = totalGastos.toFixed(2);

    document.getElementById('r-ticket-esperado').innerText = esperado.toFixed(2);
    document.getElementById('r-ticket-real').innerText = real.toFixed(2);

    const elDif = document.getElementById('r-ticket-diferencia');
    elDif.innerText = (dif >= 0 ? '+ ' : '- ') + 'BS ' + Math.abs(dif).toFixed(2);
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
        // Tomar la m·s reciente
        const ultima = rutas[0];
        await cargarRutaExistente(ultima.id);
        // Resetear IDs para que se guarde como nueva
        rutaActualId = null;
        // Limpiar pagos, crÈditos, gastos y cobranzas (solo productos se copian)
        document.getElementById('contenedor-pagos').innerHTML = '';
        document.getElementById('contenedor-creditos').innerHTML = '';
        document.getElementById('contenedor-gastos').innerHTML = '';
        document.getElementById('cobranzas-bs').value = '0.00';
        pagos = []; creditos = []; gastos = [];
        agregarPago();
        recalcularCuadre();
        alert('Ruta duplicada como base. Ajusta las cantidades y cierra cuando estÈ listo.');
    } catch (e) {
        alert('Error: ' + e.message);
    }
}

async function exportarCuadreExcel() {
    // Usamos SheetJS si est· cargado, o generamos CSV simple
    let csv = 'PRODUCTO,SALIDA,ENTRADA,VENDIDO,PRECIO BS,TOTAL BS,TOTAL $\n';
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        if (c.vendido > 0) {
            csv += `"${f.nombre}",${f.salida},${f.entrada},${c.vendido.toFixed(2)},${f.precio_bs},${c.totalBS.toFixed(2)},${c.totalUSD.toFixed(2)}\n`;
        }
    });
    csv += `\nRESUMEN,,,,,,\n`;
    csv += `VENTA TOTAL,,,,,${document.getElementById('cuadre-venta-bs').innerText},${document.getElementById('cuadre-venta-usd').innerText}\n`;
    csv += `ESPERADO,,,,,${document.getElementById('cuadre-esperado-bs').innerText},\n`;
    csv += `REAL,,,,,${document.getElementById('cuadre-real-bs').innerText},\n`;
    csv += `DIFERENCIA,,,,,${document.getElementById('cuadre-diferencia-bs').innerText},\n`;

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