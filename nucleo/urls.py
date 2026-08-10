from django.urls import path
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)
from .api import (
    TasaStatusAPIView,
    ActualizarTasaAPIView,
    CatalogoPosAPIView, 
    ProcesarVentaAPIView,
    VentasTurnoAPIView,  # <<< NUEVO
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
    BorradorFacturaListCreateAPIView,
    CargarBorradorAPIView,
    DetalleVentaFacturaAPIView,
    GenerarExcelRutaAPIView,
    ImportarExcelRutaAPIView,
    RutaMercadoListCreateAPIView,
    RutaMercadoDetalleAPIView,
    CerrarRutaMercadoAPIView,
    ReabrirRutaMercadoAPIView,
    AlmacenListAPIView,
    CatalogoRutaMercadoAPIView,
    CrearTomaFisicaAPIView, 
    TomaFisicaListAPIView, 
    TomaFisicaDetalleAPIView,
    ActualizarConteoAPIView, 
    ProcesarTomaAPIView, 
    AnularTomaAPIView,
    GenerarExcelTomaAPIView, 
    ImportarExcelTomaAPIView,
    AjusteInventarioListAPIView, 
    AjusteInventarioDetalleAPIView, 
    InformeTomaAPIView,
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
    path('api/v1/pos/ventas-turno/', VentasTurnoAPIView.as_view(), name='api_pos_ventas_turno'),

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
    
    # tasa
    path('api/v1/config/tasa-status/', TasaStatusAPIView.as_view(), name='api_tasa_status'),
    path('api/v1/config/actualizar-tasa/', ActualizarTasaAPIView.as_view(), name='api_actualizar_tasa'),

    # borradores
    path('api/v1/borradores/', BorradorFacturaListCreateAPIView.as_view(), name='api_borradores'),
    path('api/v1/borradores/<int:pk>/cargar/', CargarBorradorAPIView.as_view(), name='api_borrador_cargar'),

    # Rutas de Mercado
    path('api/v1/rutas/', RutaMercadoListCreateAPIView.as_view(), name='api_rutas'),
    path('api/v1/rutas/<int:pk>/', RutaMercadoDetalleAPIView.as_view(), name='api_ruta_detalle'),
    path('api/v1/rutas/<int:pk>/cerrar/', CerrarRutaMercadoAPIView.as_view(), name='api_ruta_cerrar'),
    path('api/v1/rutas/<int:pk>/reabrir/', ReabrirRutaMercadoAPIView.as_view(), name='api_ruta_reabrir'),
    path('api/v1/rutas/generar-excel/', GenerarExcelRutaAPIView.as_view(), name='api_generar_excel_ruta'),
    path('api/v1/rutas/importar-excel/', ImportarExcelRutaAPIView.as_view(), name='api_importar_excel_ruta'),

    path('api/v1/almacenes/', AlmacenListAPIView.as_view(), name='api_almacenes'),
    path('api/v1/rutas/catalogo/', CatalogoRutaMercadoAPIView.as_view(), name='api_rutas_catalogo'),

    # Inventarios / Toma Física
    path('api/v1/inventarios/tomas/', TomaFisicaListAPIView.as_view(), name='api_tomas_list'),
    path('api/v1/inventarios/tomas/crear/', CrearTomaFisicaAPIView.as_view(), name='api_tomas_crear'),
    path('api/v1/inventarios/tomas/<int:pk>/', TomaFisicaDetalleAPIView.as_view(), name='api_toma_detalle'),
    path('api/v1/inventarios/tomas/<int:pk>/actualizar/', ActualizarConteoAPIView.as_view(), name='api_toma_actualizar'),
    path('api/v1/inventarios/tomas/<int:pk>/procesar/', ProcesarTomaAPIView.as_view(), name='api_toma_procesar'),
    path('api/v1/inventarios/tomas/<int:pk>/anular/', AnularTomaAPIView.as_view(), name='api_toma_anular'),
    path('api/v1/inventarios/tomas/<int:pk>/generar-excel/', GenerarExcelTomaAPIView.as_view(), name='api_toma_generar_excel'),
    path('api/v1/inventarios/tomas/<int:pk>/importar-excel/', ImportarExcelTomaAPIView.as_view(), name='api_toma_importar_excel'),
    path('api/v1/inventarios/tomas/<int:pk>/informe/', InformeTomaAPIView.as_view(), name='api_toma_informe'),
    path('api/v1/inventarios/ajustes/', AjusteInventarioListAPIView.as_view(), name='api_ajustes_list'),
    path('api/v1/inventarios/ajustes/<int:pk>/', AjusteInventarioDetalleAPIView.as_view(), name='api_ajuste_detalle'),
]
