// assets/js/inventario.js

let inventarioData = [];

document.addEventListener('DOMContentLoaded', () => {
    cargarInventario();
    
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

function renderizarTabla(lista) {
    const tbody = document.getElementById('tabla-productos');
    tbody.innerHTML = '';
    
    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted py-4">No se encontraron productos</td></tr>';
        return;
    }

    lista.forEach(p => {
        // Alerta visual si el stock es crítico
        let stockClass = "text-dark";
        if (p.stock_total <= 0) stockClass = "text-danger fw-bold";
        else if (p.stock_total <= 10) stockClass = "text-warning fw-bold";

        const fila = `
            <tr>
                <td class="text-start ps-4 fw-bold text-muted">${p.codigo_base}</td>
                <td class="text-start fw-bold">${p.nombre}</td>
                <td><span class="badge bg-light text-dark border">${p.categoria}</span></td>
                <td>$ ${p.costo.toFixed(2)}</td>
                <td class="${stockClass} fs-5">${p.stock_total.toFixed(2)} <small class="fs-6 text-muted">${p.unidad}</small></td>
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

async function verFichaProducto(id) {
    try {
        const data = await apiFetch(`/inventario/productos/${id}/historial/`, 'GET');
        
        // Cabecera
        document.getElementById('ficha-nombre').innerText = data.producto.nombre;
        document.getElementById('ficha-codigo').innerText = data.producto.codigo;
        const unidadMedida = data.producto.unidad;

        // Stock por almacén
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
        alert("No se pudo cargar la información del producto.");
        console.error(error);
    }
}