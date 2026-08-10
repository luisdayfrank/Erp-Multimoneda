// assets/js/menu.js
// Menú centralizado ERP - v1.1 (Auto-inicializable)
// Inyecta la navbar completa automáticamente al cargar.

const MENU_ITEMS = [
    { id: 'dashboard',   label: 'Dashboard',            icon: 'bi-speedometer2',    href: 'dashboard.html' },
    { id: 'pos',         label: 'Punto de Venta',       icon: 'bi-shop',            href: 'pos.html' },
    { id: 'mercado',     label: 'Ruta de Mercado',      icon: 'bi-truck',           href: 'mercado.html' },
    { id: 'clientes',    label: 'Clientes',             icon: 'bi-people-fill',     href: 'clientes.html' },
    { id: 'proveedores', label: 'Proveedores',          icon: 'bi-truck',           href: 'proveedores.html' },
    { id: 'inventario',  label: 'Inventario',           icon: 'bi-box-seam',        href: 'inventario.html' },
    { id: 'compras',     label: 'Registro de Compras',  icon: 'bi-bag-plus-fill',   href: 'compras.html' }
];

const TITULOS_STANDARD = {
    'dashboard.html':   'Panel Gerencial',
    'clientes.html':    'Gestión de Clientes',
    'proveedores.html': 'Gestión de Proveedores',
    'inventario.html':  'Gestión de Inventario',
    'compras.html':     'Ingreso de Mercancía'
};

function getPaginaActual() {
    const path = window.location.pathname;
    return path.substring(path.lastIndexOf('/') + 1) || 'dashboard.html';
}

function renderizarMenuItems(paginaActual) {
    let html = '';
    let dividerPuesto = false;

    MENU_ITEMS.forEach(item => {
        if (item.id === 'clientes' && !dividerPuesto) {
            html += '<li><hr class="dropdown-divider"></li>';
            dividerPuesto = true;
        }
        const isActive = item.href === paginaActual ? 'active' : '';
        html += `<li><a class="dropdown-item ${isActive}" href="${item.href}"><i class="${item.icon} me-2"></i> ${item.label}</a></li>`;
    });

    return html;
}

/**
 * Inyecta la navbar en el contenedor #erp-navbar.
 * @param {Object} config
 * @param {string} config.tipo   - 'standard' | 'pos' | 'mercado'
 * @param {string} config.titulo - Título de la página (solo standard)
 */
function renderizarNavbar(config) {
    const tipo = config.tipo || 'standard';
    const paginaActual = getPaginaActual();
    const menuItemsHTML = renderizarMenuItems(paginaActual);

    let navbarHTML = '';

    // ── NAVBAR ESTÁNDAR ──
    if (tipo === 'standard') {
        const titulo = config.titulo || TITULOS_STANDARD[paginaActual] || '';
        navbarHTML = `
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-4 shadow">
            <div class="container-fluid">
                <div class="dropdown me-3">
                    <button class="btn btn-dark dropdown-toggle fs-5 fw-bold border-0" type="button" id="menuERP" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-grid-3x3-gap-fill me-2 text-primary"></i> ERP
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark shadow-lg" aria-labelledby="menuERP">
                        ${menuItemsHTML}
                    </ul>
                </div>
                <span class="navbar-brand mb-0 h4 border-start border-secondary ps-3">${titulo}</span>
                <div class="ms-auto d-flex text-white align-items-center">
                    <button class="btn btn-sm btn-danger fw-bold" onclick="cerrarSesion()"><i class="bi bi-box-arrow-right"></i> Salir</button>
                </div>
            </div>
        </nav>`;
    }

    // ── NAVBAR POS ──
    else if (tipo === 'pos') {
        navbarHTML = `
        <nav class="navbar navbar-dark bg-dark shadow">
            <div class="container-fluid">
                <div class="dropdown me-3">
                    <button class="btn btn-dark dropdown-toggle fs-5 fw-bold border-0" type="button" id="menuERP" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-grid-3x3-gap-fill me-2 text-primary"></i> ERP
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark shadow-lg" aria-labelledby="menuERP">
                        ${menuItemsHTML}
                    </ul>
                </div>
                <span class="navbar-brand mb-0 h1"><i class="bi bi-cpu-fill me-2"></i>ERP Sistema de Ventas</span>
                <div class="d-flex text-white align-items-center">
                    <span class="badge bg-primary me-3 fs-6" id="tasaDisplay">Tasa: BS 0.00</span>
                    <span class="me-3">Cajero: <b id="nombreCajero">Cargando...</b></span>
                    <button class="btn btn-sm btn-warning fw-bold me-2 text-dark" data-bs-toggle="modal" data-bs-target="#modalEgresos">
                        <i class="bi bi-box-arrow-up-right"></i> Gastos / Salidas
                    </button>
                    <button class="btn btn-outline-info btn-sm" onclick="abrirModalHistorial()">
                        <i class="bi bi-receipt"></i> Historial Turno
                    </button>
                    <a href="mercado.html" class="btn btn-sm btn-info fw-bold me-2 text-white">
                        <i class="bi bi-truck"></i> Mercado
                    </a>
                    <button class="btn btn-sm btn-danger fw-bold" data-bs-toggle="modal" data-bs-target="#modalCierreCaja">Cerrar Turno</button>
                </div>
            </div>
        </nav>`;
    }

    // ── NAVBAR MERCADO ──
    else if (tipo === 'mercado') {
        navbarHTML = `
        <nav class="navbar navbar-dark bg-dark shadow">
            <div class="container-fluid">
                <div class="dropdown me-3">
                    <button class="btn btn-dark dropdown-toggle fs-5 fw-bold border-0" type="button" id="menuERP" data-bs-toggle="dropdown" aria-expanded="false">
                        <i class="bi bi-grid-3x3-gap-fill me-2 text-primary"></i> ERP
                    </button>
                    <ul class="dropdown-menu dropdown-menu-dark shadow-lg" aria-labelledby="menuERP">
                        ${menuItemsHTML}
                    </ul>
                </div>
                <span class="navbar-brand mb-0 h1"><i class="bi bi-truck me-2"></i>ERP Ruta de Mercado</span>
                <div class="d-flex text-white align-items-center">
                    <span class="badge bg-primary me-3 fs-6" id="tasaDisplay">Tasa: BS 0.00</span>
                    <span class="me-3">Usuario: <b id="nombreUsuario">Cargando...</b></span>
                    <a href="pos.html" class="btn btn-sm btn-outline-light fw-bold me-2">
                        <i class="bi bi-cash-register"></i> Ir al POS
                    </a>
                    <button class="btn btn-sm btn-danger fw-bold" onclick="cerrarSesion()"><i class="bi bi-box-arrow-right"></i> Salir</button>
                </div>
            </div>
        </nav>`;
    }

    const container = document.getElementById('erp-navbar');
    if (container) {
        container.innerHTML = navbarHTML;
    } else {
        const div = document.createElement('div');
        div.id = 'erp-navbar';
        div.innerHTML = navbarHTML;
        document.body.insertBefore(div, document.body.firstChild);
    }
}

/**
 * Cierre de sesión universal.
 */
function cerrarSesion() {
    if (confirm("¿Seguro que deseas cerrar la sesión?")) {
        localStorage.clear();
        window.location.href = 'index.html';
    }
}

// =============================================================================
// AUTO-INICIALIZACIÓN: detecta la página actual y renderiza sola.
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
    const pagina = getPaginaActual();

    if (pagina === 'pos.html') {
        renderizarNavbar({ tipo: 'pos' });
    }
    else if (pagina === 'mercado.html') {
        renderizarNavbar({ tipo: 'mercado' });
    }
    else {
        renderizarNavbar({ tipo: 'standard' });
    }
});
