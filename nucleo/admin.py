from decimal import Decimal

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from django.db import transaction

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
    TomaFisica, DetalleTomaFisica, AjusteInventario, DetalleAjusteInventario,
    ReciboAbono, ReciboAbonoAplicacion,
    CierreCaja, CierrePorMetodoPago,
    TasaCambioDiaria  # FASE 1.6
)

# ==============================================================================
# 1. CONFIGURACIÓN Y CATÁLOGOS
# ==============================================================================

@admin.register(ConfiguracionGlobal)
class ConfiguracionGlobalAdmin(admin.ModelAdmin):
    list_display = (
        'moneda_principal', 'moneda_secundaria', 'tasa_cambio_actual', 'permitir_stock_negativo',
        # FASE 1.5: políticas de vuelto visibles de un vistazo
        'permitir_vuelto_a_cxc', 'permitir_vuelto_a_saldo_favor', 'vuelto_obligatorio_efectivo',
        # FASE 1.6: tasas
        'registrar_historial_tasas', 'usar_tasa_bcv'
    )
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
    list_display = ('nombre', 'moneda_referencia', 'activo', 'es_efectivo')
    list_filter = ('moneda_referencia', 'activo', 'es_efectivo')
    search_fields = ('nombre',)

# ==============================================================================
# FASE 1.6 (Anexo B.10) — Historial diario de tasas
# ==============================================================================

@admin.register(TasaCambioDiaria)
class TasaCambioDiariaAdmin(admin.ModelAdmin):
    list_display = (
        'fecha', 'tasa_bcv', 'tasa_negocio', 'diferencia_porcentual_display',
        'tasa_bcv_fuente', 'usuario_actualizo'
    )
    list_filter = ('tasa_bcv_es_manual', 'tasa_bcv_fuente', 'fecha')
    date_hierarchy = 'fecha'
    readonly_fields = ('creado_el', 'actualizado_el', 'tasa_bcv_obtenida_el')
    search_fields = ('tasa_negocio_motivo', 'tasa_bcv_fuente')
    ordering = ('-fecha',)

    def diferencia_porcentual_display(self, obj):
        d = obj.diferencia_porcentual
        if d is None:
            return "—"
        color = "🟢" if abs(d) < 1 else "🟡" if abs(d) < 3 else "🔴"
        return f"{color} {d:+.2f}%"
    diferencia_porcentual_display.short_description = "Dif. vs BCV"

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

    def get_readonly_fields(self, request, obj=None):
        # FIX VENTAS-4: una venta ya PROCESADA/ANULADA no se edita línea por
        # línea. Antes, cambiar un precio en este inline recalculaba el total
        # facturado (lo que ve el dashboard) sin ajustar el inventario.
        if obj is not None and obj.estado != 'BORRADOR':
            return [f.name for f in self.model._meta.fields]
        return []

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
    readonly_fields = ('fecha_apertura', 'fecha_cierre', 'tasa_apertura', 'get_ventas', 'get_descuadre')
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
    # FASE 1A: los campos de vuelto se calculan al facturar; no editar a mano.
    readonly_fields = (
        'fecha',
        'vuelto_total_principal', 'vuelto_entregado_principal', 'vuelto_entregado_secundaria',
        'vuelto_aplicado_cxc_principal', 'vuelto_a_saldo_favor_principal',
    )
    inlines = [DetalleVentaInline, PagoVentaInline]
    actions = ['accion_anular_ventas']

    def get_readonly_fields(self, request, obj=None):
        # FIX VENTAS-4: el estado queda congelado una vez la venta está
        # PROCESADA o ANULADA. Antes se podía hacer PROCESADA -> BORRADOR ->
        # PROCESADA: eso volvía a descontar inventario y creaba una segunda
        # CxC / nuevos abonos por la misma operación.
        base = list(self.readonly_fields)
        if obj is not None and obj.estado in ('PROCESADA', 'ANULADA'):
            base = base + ['estado']
        return base

    def accion_anular_ventas(self, request, queryset):
        """Anulación REAL: revierte inventario y elimina la CxC (Venta.anular_venta)."""
        from django.contrib import messages
        ok, errores = 0, []
        for venta in queryset:
            try:
                cxc = getattr(venta, 'cuentaporcobrar', None)
                if cxc is not None and cxc.pagos.exists():
                    errores.append(
                        f"Venta #{venta.id}: su cuenta por cobrar ya tiene abonos registrados; "
                        "revierte esos abonos antes de anular."
                    )
                    continue
                with transaction.atomic():
                    venta.anular_venta()
                ok += 1
            except Exception as e:
                errores.append(f"Venta #{venta.id}: {e}")
        if ok:
            self.message_user(request, f"Venta(s) anulada(s): {ok}. Inventario y CxC revertidos.", level=messages.SUCCESS)
        for error in errores:
            self.message_user(request, error, level=messages.ERROR)
    accion_anular_ventas.short_description = "Anular venta(s): revierte inventario y elimina la CxC"

    def save_model(self, request, obj, form, change):
        estado_anterior = None
        if obj.pk:
            try:
                estado_anterior = Venta.objects.get(pk=obj.pk).estado
            except Venta.DoesNotExist:
                pass

        self._procesar_despues = (obj.estado == 'PROCESADA' and estado_anterior != 'PROCESADA')
        
        if self._procesar_despues:
            errores = self._validar_venta_basica(obj, request)
            if errores:
                from django.contrib import messages
                for error in errores:
                    messages.error(request, error)
                self._procesar_despues = False
                obj.estado = estado_anterior or 'BORRADOR'
        
        if self._procesar_despues:
            obj.estado = 'BORRADOR'

        super().save_model(request, obj, form, change)

    def _validar_venta_basica(self, venta, request):
        errores = []
        
        if not venta.cliente:
            errores.append("La venta debe tener un cliente asignado.")
        
        if not venta.almacen:
            errores.append("La venta debe tener un almacén asignado.")
        
        if not venta.tasa_cambio_historica or venta.tasa_cambio_historica <= 0:
            errores.append("La tasa de cambio debe ser mayor a cero.")
        
        return errores

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        
        venta = form.instance
        
        if not venta.detalles.exists():
            from django.contrib import messages
            messages.error(request, "La venta debe tener al menos un producto.")
            venta.estado = 'BORRADOR'
            venta.save(update_fields=['estado'])
            return
        
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

        if getattr(self, '_procesar_despues', False):
            errores = self._validar_venta_completa(venta, request)
            if errores:
                from django.contrib import messages
                for error in errores:
                    messages.error(request, error)
                venta.estado = 'BORRADOR'
                venta.save(update_fields=['estado'])
                return
            
            try:
                with transaction.atomic():
                    venta.procesar_venta()
                from django.contrib import messages
                messages.success(request, f"✅ Venta #{venta.id} procesada. Inventario descontado.")
            except Exception as e:
                venta.estado = 'BORRADOR'
                venta.save(update_fields=['estado'])
                from django.contrib import messages
                messages.error(request, f"❌ Error al procesar: {e}. La venta quedó como BORRADOR.")

    def _validar_venta_completa(self, venta, request):
        errores = []
        
        config = ConfiguracionGlobal.objects.first()
        permitir_negativo = config.permitir_stock_negativo if config else False
        
        if not permitir_negativo:
            for detalle in venta.detalles.all():
                cantidad_base = detalle.cantidad_presentacion * detalle.presentacion.factor_conversion
                inventario = InventarioAlmacen.objects.filter(
                    producto=detalle.presentacion.producto,
                    almacen=venta.almacen
                ).first()
                
                if not inventario or inventario.stock_actual_unidades_base < cantidad_base:
                    disponible = inventario.stock_actual_unidades_base if inventario else 0
                    errores.append(
                        f"Stock insuficiente para '{detalle.presentacion.producto.nombre}'. "
                        f"Disponible: {disponible}, Requerido: {cantidad_base}"
                    )
        
        if venta.tipo == 'CREDITO' and venta.cliente:
            cliente = venta.cliente
            if cliente.limite_credito == Decimal('-1.00'):
                errores.append(f"El cliente '{cliente.nombre}' tiene crédito restringido.")
            elif cliente.limite_credito > 0:
                from django.db.models import Sum
                deuda_actual = CuentaPorCobrar.objects.filter(
                    cliente=cliente,
                    estado__in=['PENDIENTE', 'VENCIDA']
                ).exclude(venta=venta).aggregate(
                    total=Sum('saldo_pendiente')
                )['total'] or Decimal('0.00')
                
                abono_inicial = sum(
                    pago.monto_equivalente_principal 
                    for pago in venta.pagos.all()
                )
                nueva_deuda = max(Decimal('0.00'), venta.total_principal - abono_inicial)
                
                if (deuda_actual + nueva_deuda) > cliente.limite_credito:
                    errores.append(
                        f"Límite de crédito excedido. Deuda: ${deuda_actual}, "
                        f"Límite: ${cliente.limite_credito}"
                    )
        
        return errores

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

def _guardar_abonos_inline(request, form, formset, change):
    """
    Al guardar abonos desde el admin (inline):
    - Asigna el usuario que registra el abono (queda en readonly en el formulario).
    - Aplica el descuento al saldo de la cuenta, igual que hace la API,
      para no dejar la CxC/CxP desincronizada.
    - La fecha del abono es editable en el formulario (por si se registró mal).
    """
    instances = formset.save(commit=False)
    for obj in formset.deleted_objects:
        obj.delete()
    for obj in instances:
        es_nuevo = obj.pk is None
        if getattr(obj, 'usuario_id', None) is None and hasattr(obj, 'usuario'):
            obj.usuario = request.user
        obj.save()
        if es_nuevo and hasattr(obj, 'procesar_pago'):
            obj.procesar_pago()
    # Guardar relaciones m2m (si las hubiera) cuando se usó commit=False
    for form in formset.forms:
        save_m2m = getattr(form, 'save_m2m', None)
        if callable(save_m2m):
            save_m2m()


class PagoCuentaCobrarInline(admin.TabularInline):
    model = PagoCuentaCobrar
    extra = 0
    # 'fecha' es editable a propósito: permite corregir la fecha del abono
    # si se registró mal, sin tener que borrar y recrear el registro.
    # FASE 1A: 'metodo', 'sesion_caja' y 'origen' permiten cuadrar el cierre por método.
    fields = ('fecha', 'monto_abono_principal', 'monto_entregado_secundaria', 'tasa_cambio_pago',
              'metodo', 'origen', 'sesion_caja', 'referencia', 'usuario')
    readonly_fields = ('usuario',)

class PagoCuentaPagarInline(admin.TabularInline):
    model = PagoCuentaPagar
    extra = 0
    fields = ('fecha', 'monto_abono_principal', 'monto_entregado_secundaria', 'tasa_cambio_pago',
              'metodo', 'sesion_caja', 'referencia', 'usuario')
    readonly_fields = ('usuario',)

@admin.register(CuentaPorCobrar)
class CuentaPorCobrarAdmin(admin.ModelAdmin):
    list_display = ('id', 'get_venta_info', 'cliente', 'fecha_creacion', 'monto_total', 'saldo_pendiente', 'estado')
    list_filter = ('estado', 'es_deuda_inicial', 'fecha_creacion', 'fecha_vencimiento')
    search_fields = ('cliente__nombre', 'cliente__documento')
    date_hierarchy = 'fecha_creacion'
    inlines = [PagoCuentaCobrarInline]

    # La FECHA del registro se puede cambiar al agregar y al modificar.
    fields = (
        'cliente', 'venta', 'es_deuda_inicial',
        'fecha_creacion', 'fecha_vencimiento',
        'monto_total', 'saldo_pendiente', 'estado',
    )

    def get_readonly_fields(self, request, obj=None):
        # Al crear: solo estado es readonly (tiene default). Monto, saldo y FECHA editables.
        # Al editar: montos bloqueados para evitar desincronización con los abonos,
        # pero la FECHA (fecha_creacion / fecha_vencimiento) sigue siendo editable.
        if obj:
            return ('monto_total', 'saldo_pendiente', 'estado')
        return ('estado',)

    def save_formset(self, request, form, formset, change):
        _guardar_abonos_inline(request, form, formset, change)

    def get_venta_info(self, obj):
        if obj.venta:
            return f"Venta #{obj.venta.id}"
        if obj.es_deuda_inicial:
            return "Deuda Inicial"
        return "Crédito de Ruta"
    get_venta_info.short_description = 'Origen'


@admin.register(CuentaPorPagar)
class CuentaPorPagarAdmin(admin.ModelAdmin):
    list_display = ('id', 'compra', 'proveedor', 'fecha_creacion', 'monto_total', 'saldo_pendiente', 'estado')
    list_filter = ('estado', 'fecha_creacion', 'fecha_vencimiento')
    search_fields = ('proveedor__nombre',)
    inlines = [PagoCuentaPagarInline]
    fields = (
        'compra', 'proveedor',
        'fecha_creacion', 'fecha_vencimiento',
        'monto_total', 'saldo_pendiente', 'estado',
    )

    def get_readonly_fields(self, request, obj=None):
        if obj:
            return ('monto_total', 'saldo_pendiente', 'estado')
        return ('estado',)

    def save_formset(self, request, form, formset, change):
        _guardar_abonos_inline(request, form, formset, change)

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

class _RutaCerradaMixin:
    """
    FIX RUTA-1: dentro de una ruta CERRADA los inlines quedan bloqueados.
    Una ruta cerrada ya descontó inventario y creó sus CxC: editarla aquí
    cambiaba los totales que el dashboard ya había contabilizado.
    Para modificar una ruta cerrada: Reabrir -> editar -> Cerrar de nuevo.
    """
    ESTADO_BLOQUEADO = 'CERRADA'

    def _bloqueada(self, obj):
        return obj is not None and getattr(obj, 'estado', None) == self.ESTADO_BLOQUEADO

    def get_readonly_fields(self, request, obj=None):
        if self._bloqueada(obj):
            return [f.name for f in self.model._meta.fields]
        return []

    def has_add_permission(self, request, obj=None):
        if self._bloqueada(obj):
            return False
        # OJO: ModelAdmin.has_add_permission(request) no acepta obj;
        # InlineModelAdmin.has_add_permission(request, obj) sí.
        if isinstance(self, admin.options.InlineModelAdmin):
            return super().has_add_permission(request, obj)
        return admin.ModelAdmin.has_add_permission(self, request)
    
    def has_change_permission(self, request, obj=None):
        if self._bloqueada(obj):
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if self._bloqueada(obj):
            return False
        return super().has_delete_permission(request, obj)


class RutaMercadoDetalleInline(_RutaCerradaMixin, admin.TabularInline):
    model = RutaMercadoDetalle
    extra = 0


class RutaMercadoCreditoInline(_RutaCerradaMixin, admin.TabularInline):
    model = RutaMercadoCredito
    extra = 0


class RutaMercadoPagoInline(_RutaCerradaMixin, admin.TabularInline):
    model = RutaMercadoPago
    extra = 0


class RutaMercadoGastoInline(_RutaCerradaMixin, admin.TabularInline):
    model = RutaMercadoGasto
    extra = 0


@admin.register(RutaMercado)
class RutaMercadoAdmin(_RutaCerradaMixin, admin.ModelAdmin):
    list_display = ('id', 'fecha', 'usuario', 'estado', 'total_venta_usd', 'diferencia_bs')
    list_filter = ('estado', 'fecha')
    readonly_fields = (
        'total_venta_bs', 'total_venta_usd',
        'total_efectivo_bs', 'total_pago_movil_bs', 'total_punto_venta_bs',
        'total_cobranzas_bs', 'total_creditos_bs', 'total_gastos_bs',
        'recaudado_esperado_bs', 'recaudado_real_bs', 'diferencia_bs'
    )
    inlines = [RutaMercadoDetalleInline, RutaMercadoCreditoInline, RutaMercadoPagoInline, RutaMercadoGastoInline]

    def has_change_permission(self, request, obj=None):
        # OJO: seguir permitiendo ABRIR la ruta cerrada en el admin (queda de
        # solo lectura). Lo que se bloquea es escribir/borrar, no ver.
        return admin.ModelAdmin.has_change_permission(self, request, obj)

    def get_readonly_fields(self, request, obj=None):
        base = list(self.readonly_fields)
        if self._bloqueada(obj):
            base = [f.name for f in self.model._meta.fields]
        return base


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

# ==============================================================================
# RECIBOS DE ABONO
# ==============================================================================

class ReciboAbonoAplicacionInline(admin.TabularInline):
    model = ReciboAbonoAplicacion
    extra = 0
    readonly_fields = ('cuenta', 'monto_aplicado', 'saldo_antes', 'saldo_despues', 'saldo_la_factura', 'origen_dinero')
    can_delete = False

@admin.register(ReciboAbono)
class ReciboAbonoAdmin(admin.ModelAdmin):
    list_display = ('id', 'cliente', 'fecha', 'monto_total_entregado', 'total_aplicado_display', 'sobrante_a_favor', 'origen', 'usuario', 'sesion_caja')
    list_filter = ('origen', 'fecha', 'usuario', 'sesion_caja')
    search_fields = ('cliente__nombre', 'referencia')
    # 'fecha' editable: se puede corregir la fecha del recibo al agregar o modificar
    readonly_fields = ('total_aplicado_display', 'facturas_afectadas_display')
    inlines = [ReciboAbonoAplicacionInline]
    
    def total_aplicado_display(self, obj):
        return f"${obj.total_aplicado:.2f}"
    total_aplicado_display.short_description = 'Total Aplicado'
    
    def facturas_afectadas_display(self, obj):
        return obj.facturas_afectadas_count
    facturas_afectadas_display.short_description = 'Facturas Afectadas'

@admin.register(ReciboAbonoAplicacion)
class ReciboAbonoAplicacionAdmin(admin.ModelAdmin):
    list_display = ('recibo', 'cuenta', 'monto_aplicado', 'saldo_antes', 'saldo_despues', 'saldo_la_factura', 'origen_dinero')
    list_filter = ('saldo_la_factura', 'origen_dinero')
    readonly_fields = ('saldo_antes', 'saldo_despues')


# ==============================================================================
# 8. CIERRE DE CAJA (FASE 1A)
# ==============================================================================

class CierrePorMetodoPagoInline(admin.TabularInline):
    model = CierrePorMetodoPago
    extra = 0
    can_delete = False
    readonly_fields = ('metodo', 'moneda', 'esperado_en_moneda', 'esperado_equivalente_principal',
                       'declarado_en_moneda', 'declarado_equivalente_principal',
                       'descuadre_en_moneda', 'descuadre_equivalente_principal', 'observacion')


@admin.register(CierreCaja)
class CierreCajaAdmin(admin.ModelAdmin):
    """
    El cierre es una foto inmutable: solo observacion y firma_cajero son editables.
    """
    list_display = ('id', 'sesion', 'fecha_cierre', 'usuario_cierre',
                    'total_cobrado_principal', 'descuadre_principal', 'descuadre_secundaria',
                    'requiere_revision_display')
    list_filter = ('fecha_cierre', 'usuario_cierre')
    search_fields = ('sesion__usuario__username', 'observacion', 'firma_cajero')
    date_hierarchy = 'fecha_cierre'
    inlines = [CierrePorMetodoPagoInline]

    def get_readonly_fields(self, request, obj=None):
        todos = (
            'sesion', 'fecha_cierre', 'usuario_cierre',
            'total_facturado_principal', 'total_cobrado_principal',
            'total_credito_generado_principal', 'total_abonos_cxc_principal',
            'fondo_inicial_principal', 'fondo_inicial_secundaria',
            'efectivo_esperado_principal', 'efectivo_esperado_secundaria',
            'efectivo_declarado_principal', 'efectivo_declarado_secundaria',
            'descuadre_principal', 'descuadre_secundaria', 'descuadre_total_principal',
            'vuelto_entregado_principal', 'vuelto_entregado_secundaria', 'vuelto_retenido_principal',
            'tasa_apertura', 'tasa_cierre', 'diferencia_cambiaria_estimada_principal',
            'snapshot_json',
        )
        return todos

    def has_delete_permission(self, request, obj=None):
        # Un cierre histórico no se borra (auditoría).
        return False

    def requiere_revision_display(self, obj):
        return "⚠ REQUIERE REVISIÓN" if obj.requiere_revision else "OK"
    requiere_revision_display.short_description = 'Estado'


@admin.register(CierrePorMetodoPago)
class CierrePorMetodoPagoAdmin(admin.ModelAdmin):
    list_display = ('cierre', 'metodo', 'moneda', 'esperado_en_moneda', 'declarado_en_moneda',
                    'descuadre_en_moneda', 'descuadre_equivalente_principal')
    list_filter = ('moneda', 'metodo')
    readonly_fields = ('cierre', 'metodo', 'moneda', 'esperado_en_moneda', 'esperado_equivalente_principal',
                       'declarado_en_moneda', 'declarado_equivalente_principal',
                       'descuadre_en_moneda', 'descuadre_equivalente_principal')

    def has_delete_permission(self, request, obj=None):
        return False
