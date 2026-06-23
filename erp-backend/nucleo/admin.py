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
    DetalleEgresoInventario   
)

# ==============================================================================
# 1. CONFIGURACIÓN Y CATÁLOGOS
# ==============================================================================

@admin.register(ConfiguracionGlobal)
class ConfiguracionGlobalAdmin(admin.ModelAdmin):
    # Añadimos el campo a list_display y a list_editable para un acceso rápido
    list_display = ('moneda_principal', 'moneda_secundaria', 'tasa_cambio_actual', 'permitir_stock_negativo')
    list_editable = ('permitir_stock_negativo',)
    
    # Protegemos para que desde el admin no puedan agregar múltiples configuraciones
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
    # Añadimos nuestro campo 'rol' al panel de edición del usuario
    fieldsets = UserAdmin.fieldsets + (
        ('Rol en el ERP', {'fields': ('rol',)}),
    )

@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'documento', 'telefono', 'limite_credito')
    search_fields = ('nombre', 'documento')

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
    # Añadimos get_precio_secundaria a la vista
    fields = ('unidad_medida', 'factor_conversion', 'precio_venta_principal', 'get_precio_secundaria', 'get_costo', 'get_margen')
    readonly_fields = ('get_precio_secundaria', 'get_costo', 'get_margen')

    def get_costo(self, obj):
        return obj.costo_presentacion
    get_costo.short_description = 'Costo Calc.'

    def get_margen(self, obj):
        return f"{obj.margen_ganancia_porcentaje:.2f}%"
    get_margen.short_description = 'Margen Ganancia'

    def get_precio_secundaria(self, obj):
        # Evita error si el objeto aún no se ha guardado
        if obj.pk: 
            return f"{obj.precio_venta_secundaria:.2f}"
        return "0.00"
    get_precio_secundaria.short_description = 'Precio Ref. Secundario'

@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ('codigo_base', 'nombre', 'categoria', 'costo_base_moneda_principal')
    list_filter = ('categoria', 'impuesto')
    search_fields = ('codigo_base', 'nombre')
    inlines = [PresentacionProductoInline] # Acoplamos las presentaciones aquí

@admin.register(InventarioAlmacen)
class InventarioAlmacenAdmin(admin.ModelAdmin):
    list_display = ('producto', 'almacen', 'stock_actual_unidades_base')
    list_filter = ('almacen', 'producto__categoria')
    search_fields = ('producto__nombre', 'producto__codigo_base')
    # El stock solo debería moverse por compras, ventas o ajustes formales
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

# 1. Agrega esta clase arriba de SesionCajaAdmin
class EgresoCajaInline(admin.TabularInline):
    model = EgresoCaja
    extra = 0
    # Protegemos los datos para que el administrador no pueda alterar un retiro que ya se hizo
    readonly_fields = ('fecha', 'usuario', 'concepto', 'monto_extraido', 'moneda_extraida', 'monto_equivalente_principal', 'observacion')
    can_delete = False

# 2. Modifica tu SesionCajaAdmin existente para incluir el inline
@admin.register(SesionCaja)
class SesionCajaAdmin(admin.ModelAdmin):
    list_display = (
        'id', 'usuario', 'estado', 'fecha_apertura', 'fecha_cierre', 
        'get_ventas', 'get_descuadre'
    )
    list_filter = ('estado', 'usuario', 'fecha_apertura')
    readonly_fields = ('fecha_apertura', 'fecha_cierre', 'get_ventas', 'get_descuadre')
    
    # === AÑADIMOS ESTA LÍNEA ===
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
    extra = 0 # No mostrar filas vacías por defecto
    readonly_fields = ('metodo', 'monto_pagado', 'monto_equivalente_principal', 'tasa_cambio_pago', 'referencia')
    can_delete = False # Evitar que se borren pagos individuales desde aquí por seguridad

@admin.register(Venta)
class VentaAdmin(admin.ModelAdmin):
    list_display = ('id', 'fecha', 'cliente', 'tipo', 'estado', 'total_principal', 'total_secundaria')
    list_filter = ('estado', 'tipo', 'fecha', 'almacen')
    search_fields = ('cliente__nombre', 'id')
    readonly_fields = ('fecha',)
    inlines = [DetalleVentaInline, PagoVentaInline]


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
        """
        - Asigna automáticamente el usuario que crea/modifica la compra.
        - Si la tasa de cambio NO se indicó manualmente, toma la tasa actual de ConfiguracionGlobal.
        """
        if not obj.usuario_id:
            obj.usuario = request.user

        # Si el usuario no escribió una tasa, usamos la configuración global como valor por defecto.
        if not obj.tasa_cambio_historica:
            config = ConfiguracionGlobal.objects.first()
            if not config:
                from django.core.exceptions import ValidationError

                raise ValidationError(
                    "Debe existir una Configuración Global con una tasa de cambio actual "
                    "para poder registrar compras."
                )
            obj.tasa_cambio_historica = config.tasa_cambio_actual

        # Necesitamos saber el estado anterior para decidir si aplicamos movimientos
        estado_anterior = None
        if obj.pk:
            try:
                estado_anterior = Compra.objects.get(pk=obj.pk).estado
            except Compra.DoesNotExist:
                estado_anterior = None

        super().save_model(request, obj, form, change)

        # Si el usuario marcó la compra como PROCESADA y antes no lo estaba,
        # aplicamos los movimientos de inventario y la CxP SIN volver a cambiar el estado.
        if obj.estado == "PROCESADA" and estado_anterior != "PROCESADA":
            obj._aplicar_movimientos_compra()

    def save_related(self, request, form, formsets, change):
        """
        Después de guardar los detalles de la compra recalculamos:
        - subtotal_principal
        - total_impuestos_principal
        - total_principal
        - total_secundaria (usando la tasa_cambio_historica)
        """
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
        """
        JS para que, mientras se captura la compra y sus detalles en el admin,
        se vayan recalculando subtotales y totales en tiempo real.
        """

        js = ("nucleo/js/compra_admin.js",)


# ==============================================================================
# 5. CUENTAS Y CRÉDITOS
# ==============================================================================

# Inlines para ver los abonos dentro de la cuenta
class PagoCuentaCobrarInline(admin.TabularInline):
    model = PagoCuentaCobrar
    extra = 0
    readonly_fields = ('fecha', 'usuario')

class PagoCuentaPagarInline(admin.TabularInline):
    model = PagoCuentaPagar
    extra = 0
    readonly_fields = ('fecha', 'usuario')

# Modificamos los Admin que ya tenías para inyectarles los inlines
@admin.register(CuentaPorCobrar)
class CuentaPorCobrarAdmin(admin.ModelAdmin):
    list_display = ('id', 'venta', 'cliente', 'monto_total', 'saldo_pendiente', 'estado')
    list_filter = ('estado', 'fecha_vencimiento')
    search_fields = ('cliente__nombre',)
    readonly_fields = ('monto_total', 'saldo_pendiente', 'estado') # Protegemos para que solo se baje con pagos reales
    inlines = [PagoCuentaCobrarInline]

@admin.register(CuentaPorPagar)
class CuentaPorPagarAdmin(admin.ModelAdmin):
    list_display = ('id', 'compra', 'proveedor', 'monto_total', 'saldo_pendiente', 'estado')
    list_filter = ('estado', 'fecha_vencimiento')
    search_fields = ('proveedor__nombre',)
    readonly_fields = ('monto_total', 'saldo_pendiente', 'estado')
    inlines = [PagoCuentaPagarInline]


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
