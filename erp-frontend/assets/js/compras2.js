// assets/js/compras.js

let proveedoresCache = [];
let catalogoCache = [];
let carritoCompra = [];
let tasaActual = 1.00;

document.addEventListener('DOMContentLoaded', () => {
    cargarDatosIniciales();
    inicializarBuscador();
});

async function cargarDatosIniciales() {
    try {
        // 1. Obtener Proveedores
        proveedoresCache = await apiFetch('/proveedores/', 'GET');
        const selectProv = document.getElementById('compra-proveedor');
        selectProv.innerHTML = '<option value="">-- Seleccione un Proveedor --</option>';
        proveedoresCache.forEach(p => {
            selectProv.innerHTML += `<option value="${p.id}">${p.nombre} (${p.documento || 'S/N'})</option>`;
        });

        // 2. Obtener Catálogo de Productos y Tasa de Cambio (Reusamos el endpoint del POS)
        // Solicitamos el estado de la caja para extraer la tasa de cambio global
        try {
            const caja = await apiFetch('/pos/caja/', 'GET');
            tasaActual = parseFloat(caja.tasa_cambio_actual) || 1.00;
        } catch (e) {
            // Si falla la caja, podríamos estar operando sin caja abierta (el gerente no necesita caja para comprar)
            // Por precaución, dejamos la tasa en 1 si no logramos extraerla de la caja.
            console.warn("No se pudo obtener la tasa desde la caja. Asegúrate de configurar la tasa global.");
        }
        document.getElementById('compra-tasa').value = tasaActual.toFixed(2);

        // Cargamos el catálogo
        catalogoCache = await apiFetch('/pos/catalogo/', 'GET');

    } catch (error) {
        console.error("Error cargando datos base:", error);
        alert("Error de conexión. " + (error.detail || error.messageForUser || ""));
    }
}

// ==============================================================================
// BUSCADOR Y AGREGADO
// ==============================================================================
function inicializarBuscador() {
    document.getElementById('buscador-catalogo').addEventListener('input', (e) => {
        const texto = e.target.value.toLowerCase().trim();
        const contenedor = document.getElementById('lista-resultados-busqueda');
        contenedor.innerHTML = '';

        if (!texto) {
            contenedor.innerHTML = '<div class="text-muted text-center small py-3">Usa el buscador para agregar productos.</div>';
            return;
        }

        const filtrados = catalogoCache.filter(item => {
            const nom = (item.producto.nombre || '').toLowerCase();
            const cod = (item.producto.codigo_base || '').toLowerCase();
            return nom.includes(texto) || cod.includes(texto);
        });

        if (filtrados.length === 0) {
            contenedor.innerHTML = '<div class="list-group-item text-muted small">No se encontraron productos.</div>';
            return;
        }

        filtrados.forEach(item => {
            // Mostramos el producto y le ponemos un botón de agregar
            contenedor.innerHTML += `
                <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="agregarItemACompra(${item.id})">
                    <div>
                        <div class="fw-bold text-primary">${item.producto.nombre}</div>
                        <small class="text-muted">${item.producto.codigo_base} | Pres: ${item.nombre_presentacion}</small>
                    </div>
                    <i class="bi bi-plus-circle-fill text-success fs-5"></i>
                </button>
            `;
        });
    });
}

function agregarItemACompra(idPresentacion) {
    const itemCat = catalogoCache.find(i => i.id === idPresentacion);
    if (!itemCat) return;

    // Verificar si ya está en la lista
    const index = carritoCompra.findIndex(i => i.presentacion_id === idPresentacion);
    if (index > -1) {
        carritoCompra[index].cantidad += 1;
    } else {
        carritoCompra.push({
            presentacion_id: itemCat.id,
            nombre: itemCat.producto.nombre,
            presentacion: itemCat.nombre_presentacion,
            impuesto_porcentaje: parseFloat(itemCat.producto.impuesto_porcentaje || 0),
            cantidad: 1,
            // Asumimos un costo 0 para que el usuario lo llene, o podríamos intentar calcularlo si tuvieramos el costo_base
            costo_unitario: 0.00 
        });
    }

    // Limpiar buscador
    document.getElementById('buscador-catalogo').value = '';
    document.getElementById('lista-resultados-busqueda').innerHTML = '<div class="text-muted text-center small py-3">Usa el buscador para agregar productos.</div>';

    renderizarCarrito();
}

// ==============================================================================
// TABLA Y CÁLCULOS
// ==============================================================================
function actualizarFila(index, campo, valor) {
    let num = parseFloat(valor);
    if (isNaN(num) || num < 0) num = 0;
    carritoCompra[index][campo] = num;
    renderizarCarrito();
}

function eliminarFila(index) {
    carritoCompra.splice(index, 1);
    renderizarCarrito();
}

function vaciarCompra() {
    if(confirm("¿Seguro que deseas vaciar toda la lista?")) {
        carritoCompra = [];
        renderizarCarrito();
    }
}

function renderizarCarrito() {
    const tbody = document.getElementById('tabla-compra');
    tbody.innerHTML = '';

    if (carritoCompra.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-5"><i class="bi bi-box-seam fs-1 d-block mb-2"></i>Aún no has agregado productos a esta compra.</td></tr>';
        calcularTotales();
        return;
    }

    carritoCompra.forEach((item, index) => {
        const subtotal = item.cantidad * item.costo_unitario;
        item.subtotal = subtotal;

        tbody.innerHTML += `
            <tr>
                <td class="text-start ps-3">
                    <div class="fw-bold text-dark">${item.nombre}</div>
                    <small class="text-muted">${item.presentacion}</small>
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm text-center fw-bold" value="${item.cantidad}" min="0.01" step="0.01" onchange="actualizarFila(${index}, 'cantidad', this.value)">
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm text-center" value="${item.costo_unitario.toFixed(2)}" min="0.00" step="0.01" onchange="actualizarFila(${index}, 'costo_unitario', this.value)">
                </td>
                <td class="fw-bold text-primary">$ ${subtotal.toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(${index})"><i class="bi bi-x-lg"></i></button>
                </td>
            </tr>
        `;
    });

    calcularTotales();
}

function calcularTotales() {
    let subtotalUSD = 0;
    let totalImpuestos = 0;

    carritoCompra.forEach(item => {
        subtotalUSD += item.subtotal;
        totalImpuestos += item.subtotal * (item.impuesto_porcentaje / 100);
    });

    const totalUSD = subtotalUSD + totalImpuestos;
    
    // Tomamos la tasa del input por si el gerente la ajustó a mano
    const tasaInput = parseFloat(document.getElementById('compra-tasa').value) || 1.00;
    const totalBS = totalUSD * tasaInput;

    document.getElementById('compra-total-usd').innerText = `$ ${totalUSD.toFixed(2)}`;
    document.getElementById('compra-total-bs').innerText = `BS ${totalBS.toFixed(2)}`;

    return { subtotalUSD, totalImpuestos, totalUSD, totalBS, tasaInput };
}

// ==============================================================================
// PROCESAR Y ENVIAR AL BACKEND
// ==============================================================================
async function procesarCompra() {
    const proveedorId = document.getElementById('compra-proveedor').value;
    const tipoCompra = document.getElementById('compra-tipo').value;
    
    if (!proveedorId) { alert("Por favor, selecciona un proveedor."); return; }
    if (carritoCompra.length === 0) { alert("No hay productos en la lista."); return; }

    // Verificamos que no haya costos en 0
    const hayCostosCero = carritoCompra.some(item => item.costo_unitario <= 0);
    if (hayCostosCero) {
        if(!confirm("Hay productos con Costo Unitario en $0.00. ¿Estás seguro de registrar la compra así?")) {
            return;
        }
    }

    const totales = calcularTotales();

    // Construimos el Payload EXACTO que espera tu backend (ProcesarCompraAPIView)
    const payload = {
        proveedor_id: parseInt(proveedorId),
        almacen_id: 1, // Por defecto al principal. Podrías agregar un Select si tienes múltiples almacenes.
        tipo: tipoCompra,
        tasa_cambio_historica: totales.tasaInput.toFixed(2),
        subtotal_principal: totales.subtotalUSD.toFixed(2),
        total_impuestos_principal: totales.totalImpuestos.toFixed(2),
        total_principal: totales.totalUSD.toFixed(2),
        total_secundaria: totales.totalBS.toFixed(2),
        detalles: carritoCompra.map(item => ({
            presentacion_id: item.presentacion_id,
            cantidad_presentacion: item.cantidad.toFixed(2),
            precio_unitario_aplicado: item.costo_unitario.toFixed(2),
            porcentaje_impuesto_aplicado: item.impuesto_porcentaje.toFixed(2),
            subtotal: item.subtotal.toFixed(2)
        }))
    };

    const btn = document.getElementById('btn-procesar-compra');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Procesando...';

    try {
        const respuesta = await apiFetch('/compras/registrar/', 'POST', payload);
        alert(`¡Compra #${respuesta.compra_id} registrada con éxito! Stock actualizado.`);
        
        // Limpiamos todo
        document.getElementById('compra-proveedor').value = '';
        carritoCompra = [];
        renderizarCarrito();
        
    } catch (error) {
        alert("Error al procesar la compra:\n" + (error.detail || error.error || error.messageForUser || "Revisa la consola."));
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle-fill me-2"></i> REGISTRAR COMPRA E INGRESAR STOCK';
    }
}