from django.urls import path
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from .api import (
    CatalogoPosAPIView, 
    ProcesarVentaAPIView, 
    GestionCajaAPIView, 
    DashboardResumenAPIView,
    ProcesarCompraAPIView,
    RegistrarAbonoCxCAPIView,
    RegistrarAbonoMasivoAPIView,  # >>> NUEVO <<<
    DatosInicialesPOSAPIView,
    ClienteListCreateAPIView,
    ClienteDetalleHistorialAPIView,
    ClienteUpdateAPIView,
    ProductoInventarioAPIView,
    ProductoDetalleHistorialAPIView,
    ProveedorListCreateAPIView, 
    ProveedorUpdateAPIView, 
    ProveedorDetalleHistorialAPIView, 
    RegistrarAbonoCxPAPIView,
    ConceptoEgresoListAPIView,         
    RegistrarEgresoCajaAPIView,        
    RegistrarEgresoInventarioAPIView,   
    ActualizarCostosProductosAPIView,
    DetalleVentaFacturaAPIView
)

urlpatterns = [
    path('api/v1/token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/v1/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),

    # Clientes
    path('api/v1/clientes/', ClienteListCreateAPIView.as_view(), name='api_clientes'),
    path('api/v1/clientes/<int:pk>/editar/', ClienteUpdateAPIView.as_view(), name='api_cliente_editar'),
    path('api/v1/clientes/<int:pk>/historial/', ClienteDetalleHistorialAPIView.as_view(), name='api_cliente_historial'),

    # Ventas, POS y Caja
    path('api/v1/pos/catalogo/', CatalogoPosAPIView.as_view(), name='api_pos_catalogo'),
    path('api/v1/pos/datos-iniciales/', DatosInicialesPOSAPIView.as_view(), name='api_pos_datos_iniciales'),
    path('api/v1/pos/caja/', GestionCajaAPIView.as_view(), name='api_gestion_caja'),
    path('api/v1/pos/facturar/', ProcesarVentaAPIView.as_view(), name='api_pos_facturar'),
    path('api/v1/ventas/<int:pk>/detalle/', DetalleVentaFacturaAPIView.as_view(), name='api_venta_detalle'),

    # Cuentas por Cobrar (CxC)
    path('api/v1/cxc/abonar/', RegistrarAbonoCxCAPIView.as_view(), name='api_cxc_abonar'),
    path('api/v1/cxc/abonar-masivo/', RegistrarAbonoMasivoAPIView.as_view(), name='api_cxc_abonar_masivo'),  # >>> NUEVO <<<

    # Proveedores y Compras
    path('api/v1/proveedores/', ProveedorListCreateAPIView.as_view(), name='api_proveedores'),
    path('api/v1/proveedores/<int:pk>/editar/', ProveedorUpdateAPIView.as_view(), name='api_proveedor_editar'),
    path('api/v1/proveedores/<int:pk>/historial/', ProveedorDetalleHistorialAPIView.as_view(), name='api_proveedor_historial'),
    path('api/v1/compras/registrar/', ProcesarCompraAPIView.as_view(), name='api_registrar_compra'),
    path('api/v1/cxp/abonar/', RegistrarAbonoCxPAPIView.as_view(), name='api_cxp_abonar'),

    # Inventario
    path('api/v1/inventario/productos/', ProductoInventarioAPIView.as_view(), name='api_inventario_productos'),
    path('api/v1/inventario/productos/<int:pk>/historial/', ProductoDetalleHistorialAPIView.as_view(), name='api_producto_historial'),
    path('api/v1/inventario/productos/actualizar-costos/', ActualizarCostosProductosAPIView.as_view(), name='api_actualizar_costos'),

    # Egresos
    path('api/v1/egresos/conceptos/', ConceptoEgresoListAPIView.as_view(), name='api_egresos_conceptos'),
    path('api/v1/egresos/caja/', RegistrarEgresoCajaAPIView.as_view(), name='api_egresos_caja'),
    path('api/v1/egresos/inventario/', RegistrarEgresoInventarioAPIView.as_view(), name='api_egresos_inventario'),

    # Dashboard
    path('api/v1/dashboard/resumen/', DashboardResumenAPIView.as_view(), name='api_dashboard_resumen'),
]
