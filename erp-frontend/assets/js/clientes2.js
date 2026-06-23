// assets/js/clientes.js

let clientesData = [];
let datosFichaActual = null; // Guardará toda la info del cliente cuando abramos la ficha

document.addEventListener('DOMContentLoaded', () => {
    cargarClientes();
    
    // Buscador
    document.getElementById('buscador-clientes').addEventListener('input', (e) => {
        const busqueda = e.target.value.toLowerCase();
        const filtrados = clientesData.filter(c => 
            (c.nombre || '').toLowerCase().includes(busqueda) || 
            (c.documento || '').toLowerCase().includes(busqueda)
        );
        renderizarTabla(filtrados);
    });
});

async function cargarClientes() {
    try {
        clientesData = await apiFetch('/clientes/', 'GET');
        renderizarTabla(clientesData);
    } catch (error) {
        console.error("Error al cargar clientes:", error);
    }
}

function renderizarTabla(lista) {
    const tbody = document.getElementById('tabla-clientes');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-4">No se encontraron clientes</td></tr>';
        return;
    }

    lista.forEach(c => {
        const fila = `
            <tr>
                <td class="text-start ps-4 fw-bold">${c.nombre}</td>
                <td>${c.documento || 'S/D'}</td>
                <td>${c.telefono || '-'}</td>
                <td>${formatLimite(c.limite_credito)}</td>
                <td>
                    <button class="btn btn-sm btn-primary shadow-sm" onclick="verFichaCliente(${c.id})">
                        <i class="bi bi-person-vcard"></i> Ficha
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

function formatLimite(valor) {
    const v = parseFloat(valor);
    if (v === -1) return '<span class="badge bg-danger">Bloqueado</span>';
    if (v === 0) return '<span class="badge bg-info">Ilimitado</span>';
    return `<span class="badge bg-success">$ ${v.toFixed(2)}</span>`;
}

// =======================================================
// CREACIÓN Y EDICIÓN DE CLIENTES
// =======================================================

function editarClienteDesdeFicha() {
    if(!datosFichaActual) return;
    const c = datosFichaActual.cliente;
    
    // Llenar el formulario con los datos actuales
    document.getElementById('form-cliente-id').value = c.id;
    document.getElementById('form-cliente-nombre').value = c.nombre;
    document.getElementById('form-cliente-doc').value = c.documento;
    document.getElementById('form-cliente-tlf').value = c.telefono;
    document.getElementById('form-cliente-limite').value = c.limite_credito;

    // Cambiar el título del modal
    document.getElementById('modalClienteTitulo').innerHTML = '<i class="bi bi-pencil-square me-2"></i>Editar Cliente';

    // Ocultar Ficha y mostrar Formulario
    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuenta')).hide();
    new bootstrap.Modal(document.getElementById('modalClienteForm')).show();
}

// Limpiar formulario al abrir "Nuevo Cliente"
document.getElementById('modalClienteForm').addEventListener('show.bs.modal', function (event) {
    if (event.relatedTarget) { // Si se abrió desde el botón "NUEVO CLIENTE"
        document.getElementById('form-cliente-id').value = '';
        document.getElementById('form-cliente-nombre').value = '';
        document.getElementById('form-cliente-doc').value = '';
        document.getElementById('form-cliente-tlf').value = '';
        document.getElementById('form-cliente-limite').value = '0.00';
        document.getElementById('modalClienteTitulo').innerHTML = '<i class="bi bi-person-plus-fill me-2"></i>Nuevo Cliente';
    }
});

async function guardarCliente() {
    const id = document.getElementById('form-cliente-id').value;
    const payload = {
        nombre: document.getElementById('form-cliente-nombre').value.trim(),
        documento: document.getElementById('form-cliente-doc').value.trim(),
        telefono: document.getElementById('form-cliente-tlf').value.trim(),
        limite_credito: document.getElementById('form-cliente-limite').value || "0.00"
    };

    if (!payload.nombre) { alert("El nombre es obligatorio"); return; }

    try {
        if (id) {
            // Editar existente
            await apiFetch(`/clientes/${id}/editar/`, 'PUT', payload);
            alert("Cliente actualizado correctamente.");
        } else {
            // Crear nuevo
            await apiFetch('/clientes/', 'POST', payload);
            alert("Cliente registrado correctamente.");
        }
        
        bootstrap.Modal.getInstance(document.getElementById('modalClienteForm')).hide();
        cargarClientes(); // Recargar la tabla
        
        // Si estábamos en la ficha, la recargamos
        if (id && datosFichaActual) verFichaCliente(id); 

    } catch (error) {
        alert("Error al guardar: " + (error.detail || error.messageForUser || "Revisa la consola."));
    }
}

// =======================================================
// FICHA Y ABONOS
// =======================================================

async function verFichaCliente(id) {
    try {
        const data = await apiFetch(`/clientes/${id}/historial/`, 'GET');
        datosFichaActual = data; // Guardamos en memoria global
        
        // Llenar datos de la ficha
        document.getElementById('ec-cliente-nombre').innerText = data.cliente.nombre;
        document.getElementById('ec-cliente-doc').innerText = data.cliente.documento || 'S/N';
        document.getElementById('ec-cliente-tlf').innerText = data.cliente.telefono || 'S/N';
        
        document.getElementById('ec-deuda-total').innerText = `$ ${data.deuda_total.toFixed(2)}`;
        document.getElementById('ec-limite').innerText = data.limite_credito <= 0 ? 'N/A' : `$ ${data.limite_credito.toFixed(2)}`;
        
        renderizarMovimientos(data.ventas, data.pagos);
        
        const modal = new bootstrap.Modal(document.getElementById('modalEstadoCuenta'));
        modal.show();
    } catch (error) {
        alert("No se pudo cargar la información del cliente.");
    }
}

function renderizarMovimientos(ventas, pagos) {
    const contenedor = document.getElementById('contenedor-movimientos');
    contenedor.innerHTML = '';
    
    let movimientos = [
        ...ventas.map(v => ({...v, clase: 'VENTA', icon: 'bi-cart-fill', color: 'text-dark'})),
        ...pagos.map(p => ({...p, clase: 'ABONO', icon: 'bi-cash-coin', color: 'text-success'}))
    ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (movimientos.length === 0) {
        contenedor.innerHTML = '<div class="p-4 text-center text-muted">Sin movimientos registrados</div>';
        return;
    }

    movimientos.forEach(m => {
        const fecha = new Date(m.fecha).toLocaleDateString();
        const hora = new Date(m.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const html = `
            <div class="d-flex align-items-center p-3 border-bottom bg-white">
                <div class="me-3 fs-4 ${m.color}"><i class="bi ${m.icon}"></i></div>
                <div class="flex-grow-1">
                    <div class="fw-bold text-uppercase small text-muted">${m.clase} ${m.clase === 'ABONO' ? '(A Fact. #'+m.factura_id+')' : '#'+m.id}</div>
                    <div class="fw-bold">${m.clase === 'VENTA' ? 'Compra de productos' : 'Abono: ' + m.referencia}</div>
                    <div class="small text-muted">${fecha} - ${hora}</div>
                </div>
                <div class="text-end">
                    <h5 class="mb-0 fw-bold ${m.clase === 'VENTA' ? 'text-dark' : 'text-success'}">
                        ${m.clase === 'VENTA' ? '-' : '+'}$ ${m.monto.toFixed(2)}
                    </h5>
                </div>
            </div>
        `;
        contenedor.innerHTML += html;
    });
}

function abrirModalNuevoAbono() {
    if (!datosFichaActual || datosFichaActual.facturas_pendientes.length === 0) {
        alert("Este cliente no tiene deudas pendientes.");
        return;
    }

    // Llenar el select con las facturas que deben dinero
    const select = document.getElementById('abono-factura');
    select.innerHTML = '';
    datosFichaActual.facturas_pendientes.forEach(f => {
        select.innerHTML += `<option value="${f.cxc_id}">Factura #${f.venta_id} (Deuda: $${f.saldo_pendiente.toFixed(2)})</option>`;
    });

    document.getElementById('abono-monto').value = '';
    document.getElementById('abono-referencia').value = '';

    // Ocultar la ficha y mostrar el modal de abono
    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuenta')).hide();
    new bootstrap.Modal(document.getElementById('modalNuevoAbono')).show();
}

async function procesarAbono() {
    const cxc_id = document.getElementById('abono-factura').value;
    const monto = parseFloat(document.getElementById('abono-monto').value);
    const referencia = document.getElementById('abono-referencia').value.trim();

    if (!monto || monto <= 0) { alert("Ingresa un monto válido."); return; }

    const payload = {
        cuenta: cxc_id,
        monto_abono_principal: monto.toFixed(2),
        monto_entregado_secundaria: "0.00", 
        tasa_cambio_pago: datosFichaActual.tasa_actual.toFixed(2),
        referencia: referencia || "Abono manual"
    };

    try {
        await apiFetch('/cxc/abonar/', 'POST', payload);
        alert("Abono procesado con éxito.");
        
        bootstrap.Modal.getInstance(document.getElementById('modalNuevoAbono')).hide();
        cargarClientes(); // Refrescar tabla general
        verFichaCliente(datosFichaActual.cliente.id); // Reabrir la ficha actualizada
        
    } catch (error) {
        alert("Error al procesar el abono: " + (error.detail || error.messageForUser || error.error || "Monto inválido."));
    }
}