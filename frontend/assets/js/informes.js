// ==============================================================================
// CENTRO DE INFORMES — Fase 2 (bloque Inventario)
// ==============================================================================
// Render genérico: los endpoints devuelven {titulo, columnas, resultados, resumen}
// y esta pantalla los dibuja sin conocer el detalle de cada informe.
//
// NOTA DE RUTAS: aquí se llama al API con fetch directo (para poder descargar
// binarios del Excel). Si tu api.js usa otro prefijo, ajusta API_BASE.

const API_BASE = '/api/v1';

const INFORMES = {
    'valorizacion': {
        titulo: 'Valorización de Inventario',
        endpoint: '/informes/inventario/valorizacion/',
        archivo: 'valorizacion_inventario.xlsx',
        params: []
    },
    'kardex': {
        titulo: 'Kardex / Movimientos',
        endpoint: '/informes/inventario/kardex/',
        archivo: 'kardex.xlsx',
        params: ['producto']
    },
    'stock-bajo': {
        titulo: 'Stock Bajo Mínimo',
        endpoint: '/informes/inventario/stock-bajo/',
        archivo: 'stock_bajo_minimo.xlsx',
        params: ['minimo']
    },
    'sin-movimiento': {
        titulo: 'Productos sin Movimiento',
        endpoint: '/informes/inventario/sin-movimiento/',
        archivo: 'productos_sin_movimiento.xlsx',
        params: ['dias']
    },
    'rotacion': {
        titulo: 'Rotación por Categoría',
        endpoint: '/informes/inventario/rotacion/',
        archivo: 'rotacion_por_categoria.xlsx',
        params: ['dias']
    },
};

let informeActual = null;

document.addEventListener('DOMContentLoaded', () => {
    // Click en los informes del bloque inventario
    document.querySelectorAll('.reporte-link').forEach(el => {
        el.addEventListener('click', () => seleccionarInforme(el.dataset.informe));
    });

    // Enter en los filtros = generar
    ['filtro-desde', 'filtro-hasta', 'filtro-minimo', 'filtro-dias'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && informeActual) generarInforme();
        });
    });

    cargarSelectorProductos();
});

// ==============================================================================
// SELECCIÓN DE INFORME Y FILTROS
// ==============================================================================
function seleccionarInforme(id) {
    const info = INFORMES[id];
    if (!info) return;

    informeActual = id;
    document.querySelectorAll('.reporte-link').forEach(el => {
        el.classList.toggle('reporte-activo', el.dataset.informe === id);
    });

    // Mostrar solo los parámetros que usa el informe
    document.getElementById('cont-producto').style.display = info.params.includes('producto') ? '' : 'none';
    document.getElementById('cont-minimo').style.display = info.params.includes('minimo') ? '' : 'none';
    document.getElementById('cont-dias').style.display = info.params.includes('dias') ? '' : 'none';

    document.getElementById('btn-generar').disabled = false;
    document.getElementById('btn-exportar').disabled = false;
    document.getElementById('titulo-informe').innerText = info.titulo;

    generarInforme();
}

function construirQuery() {
    const partes = [];
    const desde = document.getElementById('filtro-desde').value;
    const hasta = document.getElementById('filtro-hasta').value;
    if (desde) partes.push('desde=' + desde);
    if (hasta) partes.push('hasta=' + hasta);

    const info = INFORMES[informeActual];
    if (info.params.includes('producto')) {
        const pid = document.getElementById('filtro-producto').value;
        if (!pid) {
            alert('Selecciona un producto para ver su kardex.');
            return null;
        }
        partes.push('producto_id=' + pid);
    }
    if (info.params.includes('minimo')) {
        partes.push('minimo=' + (document.getElementById('filtro-minimo').value || '10'));
    }
    if (info.params.includes('dias')) {
        partes.push('dias=' + (document.getElementById('filtro-dias').value || '90'));
    }
    return partes.length ? '?' + partes.join('&') : '';
}

// ==============================================================================
// GENERACIÓN Y RENDER
// ==============================================================================
async function generarInforme() {
    if (!informeActual) return;
    const query = construirQuery();
    if (query === null) return;

    const tbody = document.getElementById('tbody-informe');
    const panel = document.getElementById('panel-resultado');
    panel.style.display = '';
    tbody.innerHTML = '<tr><td class="text-center text-muted py-4">Generando informe...</td></tr>';

    try {
        const data = await apiFetch(INFORMES[informeActual].endpoint + query, 'GET');
        renderInforme(data);
    } catch (e) {
        tbody.innerHTML = '<tr><td class="text-center text-danger py-4">No se pudo generar el informe.</td></tr>';
        console.error('Error generando informe:', e);
    }
}

function renderInforme(data) {
    document.getElementById('titulo-informe').innerText = data.titulo || 'Informe';
    document.getElementById('total-filas').innerText =
        (data.resultados ? data.resultados.length : 0) + ' filas';

    // Chips de resumen
    const contResumen = document.getElementById('resumen-informe');
    contResumen.innerHTML = '';
    Object.entries(data.resumen || {}).forEach(([clave, valor]) => {
        const esNumero = typeof valor === 'number';
        const texto = esNumero
            ? (Number.isInteger(valor) && Math.abs(valor) < 1e9
                ? valor.toLocaleString()
                : valor.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
            : valor;
        contResumen.innerHTML += `
            <div class="border rounded px-3 py-2 bg-light">
                <small class="text-muted text-uppercase fw-bold d-block">${clave}</small>
                <span class="fw-bold fs-5">${texto}</span>
            </div>`;
    });

    // Tabla genérica
    const columnas = data.columnas || [];
    const thead = document.getElementById('thead-informe');
    const tbody = document.getElementById('tbody-informe');

    thead.innerHTML = '<tr>' + columnas.map(c => `<th>${c.titulo || c.campo}</th>`).join('') + '</tr>';

    if (!data.resultados || data.resultados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${Math.max(columnas.length, 1)}" class="text-center text-muted py-4">Sin resultados para los filtros aplicados.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.resultados.map(fila =>
        '<tr>' + columnas.map(c => {
            let v = fila[c.campo];
            if (v === null || v === undefined || v === -1) {
                v = '—';
            } else if (c.formato === 'moneda') {
                v = '$ ' + Number(v).toFixed(2);
            } else if (c.formato === 'numero') {
                v = Number(v).toFixed(2);
            } else if (c.formato === 'entero') {
                v = Number(v).toLocaleString();
            }
            return `<td>${v}</td>`;
        }).join('') + '</tr>'
    ).join('');
}

// ==============================================================================
// EXPORTACIÓN EXCEL (fetch directo con JWT, igual que api.js pero para binarios)
// ==============================================================================
async function exportarInforme() {
    if (!informeActual) return;
    const query = construirQuery();
    if (query === null) return;

    const info = INFORMES[informeActual];
    const url = API_BASE + info.endpoint + (query ? query + '&' : '?') + 'export=xlsx';

    try {
        let token = localStorage.getItem('access_token');
        let resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });

        // Reintento con refresh si el token venció (mismo patrón que pos.js)
        if (resp.status === 401 && typeof refreshAccessToken === 'function') {
            token = await refreshAccessToken();
            resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
        }

        if (!resp.ok) {
            alert('No se pudo generar el Excel (código ' + resp.status + ').');
            return;
        }

        const blob = await resp.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = info.archivo;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        alert('Error al descargar el Excel.');
        console.error(e);
    }
}

// ==============================================================================
// SELECTOR DE PRODUCTOS (para el kardex)
// ==============================================================================
async function cargarSelectorProductos() {
    try {
        const productos = await apiFetch('/inventario/productos/', 'GET');
        const select = document.getElementById('filtro-producto');
        (productos || [])
            .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
            .forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.codigo_base} - ${p.nombre}`;
                select.appendChild(opt);
            });
    } catch (e) {
        console.warn('No se pudo cargar el selector de productos:', e);
    }
}
