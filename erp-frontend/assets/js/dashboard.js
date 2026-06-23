// assets/js/dashboard.js

// ==============================================================================
// 1. INICIALIZACIÓN DEL DASHBOARD
// ==============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.querySelector('.container');
    // Ocultamos el contenedor principal para evitar que se vea la estructura vacía mientras carga
    container.style.display = 'none';

    try {
        // Solicitamos la data a nuestro endpoint optimizado en MariaDB
        // NOTA: Si el usuario es un CAJERO, esta petición fallará con un 403 Forbidden
        const data = await apiFetch('/dashboard/resumen/', 'GET');
        
        // Si obtenemos la data, pintamos la pantalla y mostramos el contenedor
        container.style.display = 'block';
        actualizarKPIs(data);
        renderizarGrafico(data);
        renderizarAlertasInventario(data.alertas.inventario_bajo);

    } catch (error) {
        console.error("Error al cargar el dashboard:", error);
        
        // Hacemos visible el contenedor para poder mostrar el mensaje de error dentro
        container.style.display = 'block';
        let errorMessageHTML = '';

        // Comprobamos si el error es de permisos (403). Usamos el texto que devuelve nuestro backend.
        if (error.detail && error.detail.includes("privilegios")) {
            errorMessageHTML = `
                <div class="alert alert-danger text-center" role="alert">
                    <h4 class="alert-heading">?? Acceso Denegado</h4>
                    <p>Tu rol de usuario no tiene los permisos necesarios para visualizar el panel gerencial.</p>
                    <hr>
                    <p class="mb-0">Esta sección es solo para personal autorizado (Gerentes o Administradores).</p>
                    <button class="btn btn-primary mt-3" onclick="window.location.href='pos.html'">Ir al Punto de Venta</button>
                </div>
            `;
        } else {
            // Para cualquier otro error (red, servidor caído, etc.)
            errorMessageHTML = `
                <div class="alert alert-warning text-center" role="alert">
                    <h4 class="alert-heading">?? ¡Ups! No se pudo conectar</h4>
                    <p>No fue posible cargar la información del Dashboard en este momento.</p>
                    <hr>
                    <p class="mb-0">Por favor, revisa que el servidor del ERP esté funcionando y que tengas conexión de red.</p>
                </div>
            `;
        }
        
        // Reemplazamos todo el contenido del dashboard con nuestro mensaje de error
        container.innerHTML = errorMessageHTML;
    }
});

// ==============================================================================
// 2. MANIPULACIÓN DEL DOM (Actualizar números y tablas)
// ==============================================================================

function actualizarKPIs(data) {
    // Ventas
    document.getElementById('kpi-ventas-hoy').innerText = `$ ${parseFloat(data.ventas.hoy_total).toFixed(2)}`;
    document.getElementById('kpi-facturas-hoy').innerText = `${data.ventas.hoy_cantidad} Facturas emitidas hoy`;
    document.getElementById('kpi-ventas-mes').innerText = `$ ${parseFloat(data.ventas.mes_total).toFixed(2)}`;

    // Deudas
    document.getElementById('kpi-cxc').innerText = `$ ${parseFloat(data.finanzas.por_cobrar_total).toFixed(2)}`;
    document.getElementById('kpi-clientes-cxc').innerText = `${data.finanzas.clientes_con_deuda} Clientes con deuda`;
    document.getElementById('kpi-cxp').innerText = `$ ${parseFloat(data.finanzas.por_pagar_total).toFixed(2)}`;
}

function renderizarAlertasInventario(alertas) {
    const tbody = document.getElementById('tabla-alertas-stock');
    tbody.innerHTML = '';

    if (alertas.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" class="text-success fw-bold py-3">Inventario Saludable</td></tr>';
        return;
    }

    alertas.forEach(item => {
        const colorClass = item.stock_actual <= 0 ? 'text-danger fw-bold' : 'text-warning fw-bold';
        
        const fila = `
            <tr>
                <td class="text-start">
                    <div class="text-truncate" style="max-width: 200px;" title="${item.producto}">
                        ${item.producto}
                    </div>
                    <small class="text-muted">${item.almacen}</small>
                </td>
                <td class="align-middle ${colorClass} fs-5">
                    ${parseFloat(item.stock_actual).toFixed(2)} <span class="fs-6">${item.unidad}</span>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

// ==============================================================================
// 3. GENERACIÓN DEL GRÁFICO CON CHART.JS
// ==============================================================================

function renderizarGrafico(data) {
    const ctx = document.getElementById('graficoFinanzas').getContext('2d');

    const ventasMes = parseFloat(data.ventas.mes_total);
    const cuentasPorCobrar = parseFloat(data.finanzas.por_cobrar_total);
    const cuentasPorPagar = parseFloat(data.finanzas.por_pagar_total);

    // Si ya existe una instancia del gráfico, la destruimos para evitar conflictos al re-renderizar
    if (window.myChart instanceof Chart) {
        window.myChart.destroy();
    }

    window.myChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Ventas del Mes', 'Dinero en la Calle (CxC)', 'Deudas a Proveedores (CxP)'],
            datasets: [{
                label: 'Monto en USD ($)',
                data: [ventasMes, cuentasPorCobrar, cuentasPorPagar],
                backgroundColor: [
                    'rgba(25, 135, 84, 0.7)',
                    'rgba(255, 193, 7, 0.7)',
                    'rgba(220, 53, 69, 0.7)'
                ],
                borderColor: [
                    'rgb(25, 135, 84)',
                    'rgb(255, 193, 7)',
                    'rgb(220, 53, 69)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '$ ' + value;
                        }
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function cerrarSesion() {
    if(confirm("¿Seguro que deseas cerrar la sesión gerencial?")) {
        localStorage.clear();
        window.location.href = 'index.html';
    }
}
