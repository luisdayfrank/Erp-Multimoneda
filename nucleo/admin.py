from decimal import Decimal

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .forms import DetalleCompraInlineForm
from .models import (
    ConfiguracionGlobal,
    Impuesto,
    UnidadMedida,
    Almacen,
    Usuario,
    Cliente,
    Proveedor,
    Categoria,
    Producto,
    PresentacionProducto,
    InventarioAlmacen,
    Venta,
    Compra,
    DetalleVenta,
    DetalleCompra,
    CuentaPorCobrar,
    CuentaPorPagar,
    PagoCuentaCobrar,
    PagoCuentaPagar,
    SesionCaja,
    MetodoPago,
    PagoVenta,
    ConceptoEgreso,           
    EgresoCaja,               
    EgresoInventario,         
    DetalleEgresoInventario,
    RutaMercado,
    RutaMercadoDetalle,
    RutaMercadoCredito,
    RutaMercadoPago,
    RutaMercadoGasto,
    BorradorFactura,
    TomaFisica, DetalleTomaFisica, AjusteInventario, DetalleAjusteInventario
)

# ==============================================================================
# 1. CONFIGURACIÓN Y CATÁLOGOS
# ==============================================================================

@admin.register(ConfiguracionGlobal)
class ConfiguracionGlobalAdmin(admin.ModelAdmin):
    list_display = ('moneda_principal', 'moneda_secundaria', 'tasa_cambio_actual', 'permitir_stock_negativo')
    list_editable = ('permitir_stock_negativo',)

    def has_add_permission(self, request):
        if ConfiguracionGlobal.objects.exists():
            return False
        return super().has_add_permission(request)

@admin.register(Impuesto)
class ImpuestoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'porcentaje')
    search_fields = ('nombre',)

@admin.register(UnidadMedida)
class UnidadMedidaAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'sigla')

@admin.register(Almacen)
class AlmacenAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'activo', 'direccion')
    list_filter = ('activo',)
    search_fields = ('nombre',)

@admin.register(MetodoPago)
class MetodoPagoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'moneda_referencia', 'activo')
    list_filter = ('moneda_referencia', 'activo')
    search_fields = ('nombre',)

# ==============================================================================
# 2. USUARIOS Y ENTIDADES
# ==============================================================================

@admin.register(Usuario)
class CustomUserAdmin(UserAdmin):
    list_display = ('username', 'email', 'first_name', 'last_name', 'rol', 'is_staff')
    list_filter = ('rol', 'is_staff', 'is_superuser')
    fieldsets = UserAdmin.fieldsets + (
        ('Rol en el ERP', {'fields': ('rol',)}),
    )

@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'documento', 'telefono', 'limite_credito', 'saldo_a_favor', 'deuda_inicial')
    search_fields = ('nombre', 'documento')
    # >>> NUEVO: Incluimos deuda_inicial en el formulario <<<
    fieldsets = (
        (None, {
            'fields': ('nombre', 'documento', 'telefono', 'direccion')
        }),
        ('Crédito', {
            'fields': ('limite_credito', 'saldo_a_favor', 'deuda_inicial'),
            'description': 'Deuda Inicial: Registra deudas de clientes antiguos sin necesidad de crear una venta. Se convierte automáticamente en Cuenta por Cobrar.'
        }),
    )

@admin.register(Proveedor)
class ProveedorAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'documento', 'telefono', 'limite_credito')
    search_fields = ('nombre', 'documento')


# ==============================================================================
# 3. INVENTARIO AVANZADO Y PRESENTACIONES
# ==============================================================================

@admin.register(Categoria)
class CategoriaAdmin(admin.ModelAdmin):
    list_display = ('nombre',)
    search_fields = ('nombre',)

class PresentacionProductoInline(admin.TabularInline):
    model = PresentacionProducto
    extra = 1
    # >>> SIMPLIFICADO: Sin precio secundario, con JS dinámico <<<
    fields = ('unidad_medida', 'factor_conversion', 'precio_venta_principal', 'get_costo', 'get_margen')
    readonly_fields = ('get_costo', 'get_margen')

    class Media:
        js = ('nucleo/js/presentacion_admin.js',)

    def get_costo(self, obj):
        return obj.costo_presentacion
    get_costo.short_description = 'Costo Calc.'

    def get_margen(self, obj):
        return f"{obj.margen_ganancia_porcentaje:.2f}%"
    get_margen.short_description = 'Margen Ganancia'

@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ('codigo_base', 'nombre', 'categoria', 'costo_base_moneda_principal', 'stock_inicial')
    list_filter = ('categoria', 'impuesto')
    search_fields = ('codigo_base', 'nombre')
    inlines = [PresentacionProductoInline]
    # >>> NUEVO: Campos stock_inicial y almacen_inicial en el formulario <<<
    fieldsets = (
        (None, {
            'fields': ('codigo_base', 'nombre', 'categoria', 'unidad_medida', 'impuesto')
        }),
        ('Costos', {
            'fields': ('costo_base_moneda_principal',)
        }),
        ('Stock Inicial', {
            'fields': ('stock_inicial', 'almacen_inicial'),
            'description': 'Define el stock inicial al crear el producto. Se deposita automáticamente en el almacén seleccionado (o el primero activo si no se elige).'
        }),
    )

@admin.register(InventarioAlmacen)
class InventarioAlmacenAdmin(admin.ModelAdmin):
    list_display = ('producto', 'almacen', 'stock_actual_unidades_base')
    list_filter = ('almacen', 'producto__categoria')
    search_fields = ('producto__nombre', 'producto__codigo_base')
    readonly_fields = ('stock_actual_unidades_base',) 


# ==============================================================================
# 4. TRANSACCIONES (VENTAS Y COMPRAS)
# ==============================================================================

class DetalleVentaInline(admin.TabularInline):
    model = DetalleVenta
    extra = 1

class DetalleCompraInline(admin.TabularInline):
    model = DetalleCompra
    extra = 1
    form = DetalleCompraInlineForm
    fields = (
        "presentacion",
        "cantidad_presentacion",
        "precio_unitario_aplicado",
        "impuesto",
        "porcentaje_impuesto_aplicado",
        "subtotal",
    )
    readonly_fields = ("porcentaje_impuesto_aplicado", "subtotal")

class EgresoCajaInline(admin.TabularInline):
    model = EgresoCaja
    extra = 0
    readonly_fields = ('fecha', 'usuario', 'concepto', 'monto_extraido', 'moneda_extraida', 'monto_equivalente_principal', 'observacion')
    can_delete = False

@admin.register(SesionCaja)
class SesionCajaAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'usuario', 'estado', 'fecha_apertura', 'fecha_cierre', 
        'get_ventas', 'get_descuadre'
    )
    list_filter = ('estado', 'usuario', 'fecha_apertura')
    readonly_fields = ('fecha_apertura', 'fecha_cierre', 'get_ventas', 'get_descuadre')
    inlines = [EgresoCajaInline] 

    def get_ventas(self, obj):
        return f"{obj.total_ventas_principal:.2f}"
    get_ventas.short_description = 'Total Vendido (Princ.)'

    def get_descuadre(self, obj):
        descuadre = obj.descuadre_principal
        if descuadre < 0:
            return f"FALTANTE: {descuadre:.2f}"
        elif descuadre > 0:
            return f"SOBRANTE: +{descuadre:.2f}"
        return "CUADRE PERFECTO"
    get_descuadre.short_description = 'Estado de Cuadre'

class PagoVentaInline(admin.TabularInline):
    model = PagoVenta
    extra = 0
    readonly_fields = ('metodo', 'monto_pagado', 'monto_equivalente_principal', 'tasa_cambio_pago', 'referencia')
    can_delete = False

@admin.register(Venta)
class VentaAdmin(admin.ModelAdmin):
    list_display = ('id', 'fecha', 'cliente', 'tipo', 'estado', 'total_principal', 'total_secundaria')
    list_filter = ('estado', 'tipo', 'fecha', 'almacen')
    search_fields = ('cliente__nombre', 'id')
    readonly_fields = ('fecha',)
    inlines = [DetalleVentaInline, PagoVentaInline]

    def save_model(self, request, obj, form, change):
        # Detectar transición a PROCESADA
        estado_anterior = None
        if obj.pk:
            try:
                estado_anterior = Venta.objects.get(pk=obj.pk).estado
            except Venta.DoesNotExist:
                pass

        # Flag para procesar después de que los inlines (detalles/pagos) se guarden
        self._procesar_despues = (obj.estado == 'PROCESADA' and estado_anterior != 'PROCESADA')

        # Si va a procesarse, guardamos temporalmente como BORRADOR porque
        # procesar_venta() valida que el estado sea BORRADOR
        if self._procesar_despues:
            obj.estado = 'BORRADOR'

        super().save_model(request, obj, form, change)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)

        venta = form.instance

        # Recalcular totales desde los detalles (igual que CompraAdmin)
        subtotal = Decimal("0.00")
        total_impuestos = Decimal("0.00")
        for detalle in venta.detalles.all():
            cantidad = detalle.cantidad_presentacion or Decimal("0.00")
            precio = detalle.precio_unitario_aplicado or Decimal("0.00")
            porcentaje = detalle.porcentaje_impuesto_aplicado or Decimal("0.00")

            detalle.subtotal = cantidad * precio
            detalle.save(update_fields=["subtotal"])

            subtotal += detalle.subtotal
            total_impuestos += detalle.subtotal * (porcentaje / Decimal("100.00"))

        venta.subtotal_principal = subtotal
        venta.total_impuestos_principal = total_impuestos
        venta.total_principal = subtotal + total_impuestos

        tasa = venta.tasa_cambio_historica or Decimal("0.00")
        venta.total_secundaria = venta.total_principal * tasa
        venta.save(update_fields=[
            "subtotal_principal", "total_impuestos_principal",
            "total_principal", "total_secundaria",
        ])

        # Procesar la venta: descuenta inventario, CxC, saldo a favor, etc.
        if getattr(self, '_procesar_despues', False):
            try:
                venta.procesar_venta()
                from django.contrib import messages
                messages.success(request, f"Venta #{venta.id} procesada exitosamente. Inventario descontado.")
            except ValueError as e:
                from django.contrib import messages
                messages.error(request, f"Error al procesar venta: {e}")


@admin.register(Compra)
class CompraAdmin(admin.ModelAdmin):
    list_display = ("id", "fecha", "proveedor", "tipo", "estado", "total_principal")
    list_filter = ("estado", "tipo", "fecha", "almacen")
    search_fields = ("proveedor__nombre", "id")
    readonly_fields = (
        "fecha",
        "usuario",
        "subtotal_principal",
        "total_impuestos_principal",
        "total_principal",
        "total_secundaria",
    )
    inlines = [DetalleCompraInline]

    def save_model(self, request, obj, form, change):
        if not obj.usuario_id:
            obj.usuario = request.user

        if not obj.tasa_cambio_historica:
            config = ConfiguracionGlobal.objects.first()
            if not config:
                from django.core.exceptions import ValidationError
                raise ValidationError(
                    "Debe existir una Configuración Global con una tasa de cambio actual "
                    "para poder registrar compras."
                )
            obj.tasa_cambio_historica = config.tasa_cambio_actual

        estado_anterior = None
        if obj.pk:
            try:
                estado_anterior = Compra.objects.get(pk=obj.pk).estado
            except Compra.DoesNotExist:
                estado_anterior = None

        super().save_model(request, obj, form, change)

        if obj.estado == "PROCESADA" and estado_anterior != "PROCESADA":
            obj._aplicar_movimientos_compra()

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)

        compra = form.instance
        subtotal = Decimal("0.00")
        total_impuestos = Decimal("0.00")

        for detalle in compra.detalles.all():
            cantidad = detalle.cantidad_presentacion or Decimal("0.00")
            precio = detalle.precio_unitario_aplicado or Decimal("0.00")
            porcentaje = detalle.porcentaje_impuesto_aplicado or Decimal("0.00")

            detalle.subtotal = cantidad * precio
            detalle.save(update_fields=["subtotal"])

            subtotal += detalle.subtotal
            total_impuestos += detalle.subtotal * (porcentaje / Decimal("100.00"))

        compra.subtotal_principal = subtotal
        compra.total_impuestos_principal = total_impuestos
        compra.total_principal = subtotal + total_impuestos

        tasa = compra.tasa_cambio_historica or Decimal("0.00")
        compra.total_secundaria = compra.total_principal * tasa
        compra.save(
            update_fields=[
                "subtotal_principal",
                "total_impuestos_principal",
                "total_principal",
                "total_secundaria",
            ]
        )

    class Media:
        js = ("nucleo/js/compra_admin.js",)


# ==============================================================================
# 5. CUENTAS Y CRÉDITOS
# ==============================================================================

class PagoCuentaCobrarInline(admin.TabularInline):
    model = PagoCuentaCobrar
    extra = 0
    readonly_fields = ('fecha', 'usuario')

class PagoCuentaPagarInline(admin.TabularInline):
    model = PagoCuentaPagar
    extra = 0
    readonly_fields = ('fecha', 'usuario')

@admin.register(CuentaPorCobrar)
class CuentaPorCobrarAdmin(admin.ModelAdmin):
    list_display = ('id', 'get_venta_info', 'cliente', 'monto_total', 'saldo_pendiente', 'estado')
    list_filter = ('estado', 'fecha_vencimiento')
    search_fields = ('cliente__nombre',)
    inlines = [PagoCuentaCobrarInline]

    def get_readonly_fields(self, request, obj=None):
        # Al crear: solo estado es readonly (tiene default). Monto y saldo deben ser editables.
        # Al editar: todo bloqueado para evitar desincronización.
        if obj:
            return ('monto_total', 'saldo_pendiente', 'estado')
        return ('estado',)

    def get_venta_info(self, obj):
        if obj.venta:
            return f"Venta #{obj.venta.id}"
        return "Deuda Inicial"
    get_venta_info.short_description = 'Origen'


@admin.register(CuentaPorPagar)
class CuentaPorPagarAdmin(admin.ModelAdmin):
    list_display = ('id', 'compra', 'proveedor', 'monto_total', 'saldo_pendiente', 'estado')
    list_filter = ('estado', 'fecha_vencimiento')
    search_fields = ('proveedor__nombre',)
    inlines = [PagoCuentaPagarInline]

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return ('monto_total', 'saldo_pendiente', 'estado')
        return ('estado',)

@admin.register(ConceptoEgreso)
class ConceptoEgresoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'tipo', 'activo')
    list_filter = ('tipo', 'activo')

class DetalleEgresoInventarioInline(admin.TabularInline):
    model = DetalleEgresoInventario
    extra = 1

@admin.register(EgresoInventario)
class EgresoInventarioAdmin(admin.ModelAdmin):
    list_display = ('id', 'fecha', 'concepto', 'usuario', 'total_costo_principal', 'estado')
    list_filter = ('estado', 'concepto', 'fecha')
    inlines = [DetalleEgresoInventarioInline]
    readonly_fields = ('total_costo_principal',)

@admin.register(EgresoCaja)
class EgresoCajaAdmin(admin.ModelAdmin):
    list_display = ('fecha', 'sesion_caja', 'concepto', 'monto_extraido', 'moneda_extraida', 'usuario')
    list_filter = ('moneda_extraida', 'concepto', 'fecha')

@admin.register(BorradorFactura)
class BorradorFacturaAdmin(admin.ModelAdmin):
    list_display = ('id', 'nombre', 'cliente', 'cajero', 'total_principal', 'creado_el')
    list_filter = ('creado_el', 'cajero')
    search_fields = ('nombre', 'cliente__nombre')

# ==============================================================================
# RUTAS DE MERCADO
# ==============================================================================

class RutaMercadoDetalleInline(admin.TabularInline):
    model = RutaMercadoDetalle
    extra = 0

class RutaMercadoCreditoInline(admin.TabularInline):
    model = RutaMercadoCredito
    extra = 0

class RutaMercadoPagoInline(admin.TabularInline):
    model = RutaMercadoPago
    extra = 0

class RutaMercadoGastoInline(admin.TabularInline):
    model = RutaMercadoGasto
    extra = 0

@admin.register(RutaMercado)
class RutaMercadoAdmin(admin.ModelAdmin):
    list_display = ('id', 'fecha', 'usuario', 'estado', 'total_venta_usd', 'diferencia_bs')
    list_filter = ('estado', 'fecha')
    readonly_fields = (
        'total_venta_bs', 'total_venta_usd',
        'total_efectivo_bs', 'total_pago_movil_bs', 'total_punto_venta_bs',
        'total_cobranzas_bs', 'total_creditos_bs', 'total_gastos_bs',
        'recaudado_esperado_bs', 'recaudado_real_bs', 'diferencia_bs'
    )
    inlines = [RutaMercadoDetalleInline, RutaMercadoCreditoInline, RutaMercadoPagoInline, RutaMercadoGastoInline]


# ==============================================================================
# TOMA FÍSICA Y AJUSTES
# ==============================================================================

class DetalleTomaFisicaInline(admin.TabularInline):
    model = DetalleTomaFisica
    extra = 0
    readonly_fields = ('diferencia', 'subtotal_diferencia')
    fields = ('producto', 'stock_teorico', 'stock_fisico', 'diferencia', 'costo_unitario_snapshot', 'observacion_linea')

@admin.register(TomaFisica)
class TomaFisicaAdmin(admin.ModelAdmin):
    list_display = ('id', 'almacen', 'tipo', 'estado', 'fecha_creacion', 'fecha_cierre', 'diferencia_total')
    list_filter = ('estado', 'tipo', 'almacen', 'fecha_creacion')
    search_fields = ('id', 'observacion')
    readonly_fields = ('fecha_creacion', 'fecha_cierre', 'total_esperado', 'total_fisico', 'diferencia_total')
    inlines = [DetalleTomaFisicaInline]

class DetalleAjusteInventarioInline(admin.TabularInline):
    model = DetalleAjusteInventario
    extra = 0
    readonly_fields = ('subtotal_costo',)
    fields = ('producto', 'cantidad_ajustada', 'costo_unitario_aplicado', 'subtotal_costo', 'tipo_ajuste')

@admin.register(AjusteInventario)
class AjusteInventarioAdmin(admin.ModelAdmin):
    list_display = ('id', 'toma_fisica', 'almacen', 'estado', 'fecha', 'total_costo_ajuste')
    list_filter = ('estado', 'almacen', 'fecha')
    readonly_fields = ('fecha', 'total_costo_ajuste')
    inlines = [DetalleAjusteInventarioInline]
