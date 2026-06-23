// assets/js/proveedores.js

let proveedoresData = [];
let datosFichaProv = null; 

document.addEventListener('DOMContentLoaded', () => {
    cargarProveedores();
    
    document.getElementById('buscador-proveedores').addEventListener('input', (e) => {
        const busqueda = e.target.value.toLowerCase();
        const filtrados = proveedoresData.filter(p => 
            (p.nombre || '').toLowerCase().includes(busqueda) || 
            (p.documento || '').toLowerCase().includes(busqueda)
        );
        renderizarTabla(filtrados);
    });
});

async function cargarProveedores() {
    try {
        proveedoresData = await apiFetch('/proveedores/', 'GET');
        renderizarTabla(proveedoresData);
    } catch (error) {
        console.error("Error al cargar proveedores:", error);
    }
}

function renderizarTabla(lista) {
    const tbody = document.getElementById('tabla-proveedores');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-4">No se encontraron proveedores</td></tr>';
        return;
    }

    lista.forEach(p => {
        const fila = `
            <tr>
                <td class="text-start ps-4 fw-bold">${p.nombre}</td>
                <td>${p.documento || 'S/D'}</td>
                <td>${p.telefono || '-'}</td>
                <td>${formatLimite(p.limite_credito)}</td>
                <td>
                    <button class="btn btn-sm btn-primary shadow-sm" onclick="verFichaProveedor(${p.id})">
                        <i class="bi bi-person-vcard"></i> Ficha CxP
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

function formatLimite(valor) {
    const v = parseFloat(valor);
    if (v === 0) return '<span class="badge bg-info">Sin Límite Definido</span>';
    return `<span class="badge bg-success">$ ${v.toFixed(2)}</span>`;
}

// CREACIÓN Y EDICIÓN
function editarProvDesdeFicha() {
    if(!datosFichaProv) return;
    const p = datosFichaProv.proveedor;
    
    document.getElementById('form-prov-id').value = p.id;
    document.getElementById('form-prov-nombre').value = p.nombre;
    document.getElementById('form-prov-doc').value = p.documento;
    document.getElementById('form-prov-tlf').value = p.telefono;
    document.getElementById('form-prov-limite').value = p.limite_credito;

    document.getElementById('modalProvTitulo').innerHTML = '<i class="bi bi-pencil-square me-2"></i>Editar Proveedor';

    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuentaProv')).hide();
    new bootstrap.Modal(document.getElementById('modalProveedorForm')).show();
}

document.getElementById('modalProveedorForm').addEventListener('show.bs.modal', function (event) {
    if (event.relatedTarget) { 
        document.getElementById('form-prov-id').value = '';
        document.getElementById('form-prov-nombre').value = '';
        document.getElementById('form-prov-doc').value = '';
        document.getElementById('form-prov-tlf').value = '';
        document.getElementById('form-prov-limite').value = '0.00';
        document.getElementById('modalProvTitulo').innerHTML = '<i class="bi bi-building me-2"></i>Nuevo Proveedor';
    }
});

async function guardarProveedor() {
    const id = document.getElementById('form-prov-id').value;
    const payload = {
        nombre: document.getElementById('form-prov-nombre').value.trim(),
        documento: document.getElementById('form-prov-doc').value.trim(),
        telefono: document.getElementById('form-prov-tlf').value.trim(),
        limite_credito: document.getElementById('form-prov-limite').value || "0.00"
    };

    if (!payload.nombre) { alert("El nombre es obligatorio"); return; }

    try {
        if (id) {
            await apiFetch(`/proveedores/${id}/editar/`, 'PUT', payload);
            alert("Proveedor actualizado.");
        } else {
            await apiFetch('/proveedores/', 'POST', payload);
            alert("Proveedor registrado.");
        }
        
        bootstrap.Modal.getInstance(document.getElementById('modalProveedorForm')).hide();
        cargarProveedores();
        if (id && datosFichaProv) verFichaProveedor(id); 

    } catch (error) {
        alert("Error al guardar: " + (error.detail || error.messageForUser || "Revisa la consola."));
    }
}

// FICHA Y ABONOS A CxP
async function verFichaProveedor(id) {
    try {
        const data = await apiFetch(`/proveedores/${id}/historial/`, 'GET');
        datosFichaProv = data; 
        
        document.getElementById('ep-prov-nombre').innerText = data.proveedor.nombre;
        document.getElementById('ep-prov-doc').innerText = data.proveedor.documento || 'S/N';
        
        document.getElementById('ep-deuda-total').innerText = `$ ${data.deuda_total.toFixed(2)}`;
        document.getElementById('ep-limite').innerText = data.limite_credito <= 0 ? 'Ilimitado' : `$ ${data.limite_credito.toFixed(2)}`;
        
        renderizarMovimientosProv(data.compras, data.pagos);
        
        const modal = new bootstrap.Modal(document.getElementById('modalEstadoCuentaProv'));
        modal.show();
    } catch (error) {
        alert("No se pudo cargar la información del proveedor.");
    }
}

function renderizarMovimientosProv(compras, pagos) {
    const contenedor = document.getElementById('contenedor-movimientos-prov');
    contenedor.innerHTML = '';
    
    let movimientos = [
        ...compras.map(c => ({...c, clase: 'COMPRA', icon: 'bi-bag-check-fill', color: 'text-dark'})),
        ...pagos.map(p => ({...p, clase: 'PAGO EMITIDO', icon: 'bi-cash-coin', color: 'text-success'}))
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
                    <div class="fw-bold text-uppercase small text-muted">${m.clase} ${m.clase === 'PAGO EMITIDO' ? '(A Fact. #'+m.factura_id+')' : '#'+m.id}</div>
                    <div class="fw-bold">${m.clase === 'COMPRA' ? 'Recepción de Mercancía' : 'Pago: ' + m.referencia}</div>
                    <div class="small text-muted">${fecha} - ${hora}</div>
                </div>
                <div class="text-end">
                    <h5 class="mb-0 fw-bold ${m.clase === 'COMPRA' ? 'text-danger' : 'text-success'}">
                        ${m.clase === 'COMPRA' ? '+' : '-'}$ ${m.monto.toFixed(2)}
                    </h5>
                </div>
            </div>
        `;
        contenedor.innerHTML += html;
    });
}

function abrirModalNuevoAbonoProv() {
    if (!datosFichaProv || datosFichaProv.facturas_pendientes.length === 0) {
        alert("No tenemos deudas pendientes con este proveedor.");
        return;
    }

    const select = document.getElementById('abono-factura-prov');
    select.innerHTML = '';
    datosFichaProv.facturas_pendientes.forEach(f => {
        select.innerHTML += `<option value="${f.cxp_id}">Compra #${f.compra_id} (Deuda: $${f.saldo_pendiente.toFixed(2)})</option>`;
    });

    document.getElementById('abono-monto-prov').value = '';
    document.getElementById('abono-referencia-prov').value = '';

    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuentaProv')).hide();
    new bootstrap.Modal(document.getElementById('modalNuevoAbonoProv')).show();
}

async function procesarAbonoProv() {
    const cxp_id = document.getElementById('abono-factura-prov').value;
    const monto = parseFloat(document.getElementById('abono-monto-prov').value);
    const referencia = document.getElementById('abono-referencia-prov').value.trim();

    if (!monto || monto <= 0) { alert("Ingresa un monto válido."); return; }

    const payload = {
        cuenta: cxp_id,
        monto_abono_principal: monto.toFixed(2),
        monto_entregado_secundaria: "0.00", 
        tasa_cambio_pago: datosFichaProv.tasa_actual.toFixed(2),
        referencia: referencia || "Pago emitido"
    };

    try {
        await apiFetch('/cxp/abonar/', 'POST', payload);
        alert("Pago a proveedor registrado exitosamente.");
        
        bootstrap.Modal.getInstance(document.getElementById('modalNuevoAbonoProv')).hide();
        cargarProveedores(); 
        verFichaProveedor(datosFichaProv.proveedor.id); 
        
    } catch (error) {
        alert("Error al procesar el pago: " + (error.detail || error.messageForUser || error.error || "Monto inválido."));
    }
}