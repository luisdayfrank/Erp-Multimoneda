// assets/js/inventario.js

let inventarioData = [];

document.addEventListener('DOMContentLoaded', () => {
    cargarInventario();
    cargarKPIValor();  // MEJORA INVENTARIO
    
    // Buscador
    document.getElementById('buscador-productos').addEventListener('input', (e) => {
        const busqueda = e.target.value.toLowerCase();
        const filtrados = inventarioData.filter(p => 
            (p.nombre || '').toLowerCase().includes(busqueda) || 
            (p.codigo_base || '').toLowerCase().includes(busqueda)
        );
        renderizarTabla(filtrados);
    });
});

async function cargarInventario() {
    try {
        inventarioData = await apiFetch('/inventario/productos/', 'GET');
        renderizarTabla(inventarioData);
    } catch (error) {
        console.error("Error al cargar inventario:", error);
    }
}

// ==============================================================================
// MEJORA INVENTARIO — KPI de valor total del inventario
// ==============================================================================
async function cargarKPIValor() {
    try {
        const kpi = await apiFetch('/inventario/resumen-valor/', 'GET');
        document.getElementById('kpi-valor-inventario').innerText =
            `$ ${parseFloat(kpi.valor_total_usd).toFixed(2)}`;
        document.getElementById('kpi-valor-detalle').innerText =
            `${kpi.productos_con_stock} productos · ${kpi.almacenes_activos} almacenes`;
    } catch (e) {
        console.error('No se pudo cargar el valor del inventario:', e);
    }
}

function renderizarTabla(lista) {
    const tbody = document.getElementById('tabla-productos');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-muted py-4">No se encontraron productos</td></tr>';
        return;
    }

    lista.forEach(p => {
        // Alerta visual si el stock es cr�tico
        let stockClass = "text-dark";
        if (p.stock_total <= 0) stockClass = "text-danger fw-bold";
        else if (p.stock_total <= 10) stockClass = "text-warning fw-bold";

        const fila = `
            <tr>
                <td class="text-start ps-4 fw-bold text-muted">${p.codigo_base}</td>
                <td class="text-start fw-bold">${p.nombre}</td>
                <td><span class="badge bg-light text-dark border">${p.categoria}</span></td>
                <td>$ ${p.costo.toFixed(2)}</td>
                <td class="${stockClass} fs-5" style="cursor:pointer" onclick="verDesgloseStock(${p.id})"
                    title="Clic para ver el desglose por presentación">
                    ${p.stock_total.toFixed(2)} <small class="fs-6 text-muted">${p.unidad}</small>
                    <i class="bi bi-info-circle ms-1"></i>
                </td>
                <td class="fw-bold text-success">$ ${(p.valor_stock || 0).toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-info text-white shadow-sm" onclick="verFichaProducto(${p.id})">
                        <i class="bi bi-clipboard2-data"></i> Kardex
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" data-bs-toggle="modal" data-bs-target="#modalProductoForm">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

// ==============================================================================
// MEJORA INVENTARIO — Modal de desglose por presentación (greedy)
// ==============================================================================
async function verDesgloseStock(productoId) {
    const body = document.getElementById('desglose-stock-body');
    body.innerHTML = '<div class="text-center text-muted py-4">Cargando...</div>';
    new bootstrap.Modal(document.getElementById('modalDesgloseStock')).show();

    try {
        const d = await apiFetch(`/inventario/productos/${productoId}/desglose/`, 'GET');

        const colores = ['text-success', 'text-warning', 'text-info', 'text-primary', 'text-secondary'];
        const iconos = ['bi-box-fill', 'bi-box-seam-fill', 'bi-boxes', 'bi-box', 'bi-circle-fill'];

        let html = `
            <div class="text-center mb-3">
                <h5 class="fw-bold">${d.producto.nombre}</h5>
                <span class="badge bg-secondary">${d.producto.codigo}</span>
                <div class="mt-2">
                    <span class="text-muted">Stock total:</span>
                    <strong>${d.stock_total_base.toFixed(2)} ${d.producto.unidad_base}</strong>
                </div>
                <div>
                    <span class="text-muted">Valor:</span>
                    <strong class="text-success">$${d.valor_total.toFixed(2)}</strong>
                </div>
            </div>
            <hr>
            <h6 class="text-muted text-uppercase fw-bold">Desglose total</h6>
            <ul class="list-group mb-3">`;

        if (!d.desglose_global.desglose || d.desglose_global.desglose.length === 0) {
            html += `<li class="list-group-item text-muted">Sin stock para desglosar.</li>`;
        }

        (d.desglose_global.desglose || []).forEach((item, i) => {
            const color = colores[i % colores.length];
            const icono = iconos[i % iconos.length];
            html += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span><i class="bi ${icono} ${color} me-2"></i>${item.nombre}</span>
                    <span>
                        <strong class="${color} fs-5">${item.cantidad}</strong>
                        <small class="text-muted">(${Number(item.unidades_base).toFixed(2)} ${d.producto.unidad_base})</small>
                    </span>
                </li>`;
        });

        // Residuo fraccionario (ej: 0.5 kg que no alcanza una presentación completa)
        if (d.desglose_global.residuo_unidades > 0) {
            html += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    <span><i class="bi bi-circle me-2 text-muted"></i>Residuo</span>
                    <strong class="text-muted">${Number(d.desglose_global.residuo_unidades).toFixed(2)} ${d.producto.unidad_base}</strong>
                </li>`;
        }
        html += `</ul>`;

        if (d.por_almacen.length > 1) {
            html += `<h6 class="text-muted text-uppercase fw-bold">Por almacén</h6><ul class="list-group">`;
            d.por_almacen.forEach(a => {
                const detalle = (a.desglose || []).map(x => `${x.cantidad} ${x.sigla}`).join(' + ') || '—';
                html += `
                    <li class="list-group-item d-flex justify-content-between">
                        <span><i class="bi bi-building me-2"></i>${a.almacen}</span>
                        <small class="text-muted">${detalle} (${Number(a.stock_base).toFixed(2)} ${d.producto.unidad_base})</small>
                    </li>`;
            });
            html += `</ul>`;
        }

        body.innerHTML = html;
    } catch (e) {
        body.innerHTML = `<div class="alert alert-danger">No se pudo cargar el desglose.</div>`;
        console.error(e);
    }
}

async function verFichaProducto(id) {
    try {
        const data = await apiFetch(`/inventario/productos/${id}/historial/`, 'GET');
        
        // Cabecera
        document.getElementById('ficha-nombre').innerText = data.producto.nombre;
        document.getElementById('ficha-codigo').innerText = data.producto.codigo;
        const unidadMedida = data.producto.unidad;

        // Stock por almac�n
        const listAlmacenes = document.getElementById('ficha-stock-almacenes');
        listAlmacenes.innerHTML = '';
        data.stock_por_almacen.forEach(s => {
            listAlmacenes.innerHTML += `
                <li class="list-group-item d-flex justify-content-between align-items-center px-0">
                    ${s.almacen}
                    <span class="badge bg-primary rounded-pill fs-6">${s.cantidad.toFixed(2)} ${unidadMedida}</span>
                </li>
            `;
        });

        // Presentaciones
        const listPres = document.getElementById('ficha-presentaciones');
        listPres.innerHTML = '';
        data.presentaciones.forEach(p => {
            listPres.innerHTML += `
                <li class="list-group-item px-0">
                    <div class="d-flex justify-content-between fw-bold">
                        <span>${p.nombre} (x${p.factor})</span>
                        <span class="text-success">$ ${p.precio_usd.toFixed(2)}</span>
                    </div>
                </li>
            `;
        });

        // Movimientos (Entradas y Salidas)
        const contMov = document.getElementById('ficha-movimientos');
        contMov.innerHTML = '';
        if (data.movimientos.length === 0) {
            contMov.innerHTML = '<div class="p-4 text-center text-muted">No hay movimientos registrados.</div>';
        } else {
            data.movimientos.forEach(m => {
                const esEntrada = m.tipo === 'ENTRADA';
                const color = esEntrada ? 'text-success' : 'text-danger';
                const icon = esEntrada ? 'bi-box-arrow-in-right' : 'bi-box-arrow-up-right';
                const signo = esEntrada ? '+' : '-';
                
                const fecha = new Date(m.fecha).toLocaleDateString();
                const hora = new Date(m.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                contMov.innerHTML += `
                    <div class="d-flex align-items-center p-3 border-bottom bg-white">
                        <div class="me-3 fs-4 ${color}"><i class="bi ${icon}"></i></div>
                        <div class="flex-grow-1">
                            <div class="fw-bold text-uppercase small ${color}">${m.tipo}</div>
                            <div class="fw-bold text-dark">${m.motivo}</div>
                            <div class="small text-muted">${fecha} - ${hora}</div>
                        </div>
                        <div class="text-end">
                            <h5 class="mb-0 fw-bold ${color}">${signo} ${m.cantidad.toFixed(2)} <span class="fs-6">${unidadMedida}</span></h5>
                        </div>
                    </div>
                `;
            });
        }

        const modal = new bootstrap.Modal(document.getElementById('modalFichaProducto'));
        modal.show();

    } catch (error) {
        alert("No se pudo cargar la informaci�n del producto.");
        console.error(error);
    }
}