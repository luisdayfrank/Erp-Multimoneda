from decimal import Decimal
from rest_framework import serializers
from .models import (Producto, PresentacionProducto, Venta, DetalleVenta, SesionCaja,
    PagoCuentaCobrar,MetodoPago, PagoVenta, Cliente, Proveedor, PagoCuentaPagar, ConfiguracionGlobal,
    ConceptoEgreso, EgresoCaja, EgresoInventario, DetalleEgresoInventario, SesionCaja, ConceptoEgreso,
    Compra, DetalleCompra, ConfiguracionGlobal, ConceptoEgreso, EgresoCaja, EgresoInventario, DetalleEgresoInventario,
    RutaMercado,
    RutaMercadoDetalle,
    RutaMercadoCredito,
    RutaMercadoPago,
    RutaMercadoGasto,
    BorradorFactura
    )
from django.utils import timezone

# --- SERIALIZADORES DE CAJA ---

class SesionCajaSerializer(serializers.ModelSerializer):
    total_ventas_principal = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    descuadre_principal = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    cajero = serializers.SerializerMethodField()
    requiere_cierre_obligatorio = serializers.SerializerMethodField()
    tasa_cambio_actual = serializers.SerializerMethodField()
    total_egresos_caja_principal = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    cajero_puede_cambiar_precio = serializers.SerializerMethodField()
    rol_usuario = serializers.SerializerMethodField()

    class Meta:
        model = SesionCaja
        fields = [
            'id', 'usuario', 'cajero', 'fecha_apertura', 'fecha_cierre', 'estado',
            'fondo_inicial_principal', 'fondo_inicial_secundaria',
            'reporte_cierre_principal', 'reporte_cierre_secundaria',
            'total_ventas_principal', 'descuadre_principal',
            'requiere_cierre_obligatorio', 'tasa_cambio_actual', 'total_egresos_caja_principal',
            'cajero_puede_cambiar_precio', 'rol_usuario'
        ]
        read_only_fields = ['id', 'usuario', 'cajero', 'fecha_apertura', 'fecha_cierre']

    def get_cajero(self, obj):
        return obj.usuario.username if obj.usuario else None

    def get_tasa_cambio_actual(self, obj):
        config = ConfiguracionGlobal.objects.first()
        return float(config.tasa_cambio_actual) if config else 1.00

    def get_requiere_cierre_obligatorio(self, obj):
        if obj.estado == 'ABIERTA' and obj.fecha_apertura:
            hoy = timezone.localtime().date()
            fecha_apertura_dia = timezone.localtime(obj.fecha_apertura).date()
            if fecha_apertura_dia < hoy:
                return True
        return False

    def get_cajero_puede_cambiar_precio(self, obj):
        config = ConfiguracionGlobal.objects.first()
        return config.cajero_puede_cambiar_precio if config else False

    def get_rol_usuario(self, obj):
        return obj.usuario.rol if obj.usuario else 'CAJERO'

class MetodoPagoSerializer(serializers.ModelSerializer):
    class Meta:
        model = MetodoPago
        fields = ['id', 'nombre', 'moneda_referencia']

class ClienteSerializer(serializers.ModelSerializer):
    deuda_total = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = Cliente
        fields = ['id', 'nombre', 'documento', 'telefono', 'limite_credito', 'saldo_a_favor', 'deuda_inicial', 'deuda_total']

# --- SERIALIZADORES DE CATÁLOGO (Para enviar al POS) ---

class ProductoPosSerializer(serializers.ModelSerializer):
    impuesto_porcentaje = serializers.DecimalField(
        source='impuesto.porcentaje', max_digits=5, decimal_places=2, read_only=True
    )

    class Meta:
        model = Producto
        fields = ['id', 'codigo_base', 'nombre', 'impuesto_porcentaje']

class PresentacionProductoSerializer(serializers.ModelSerializer):
    producto = ProductoPosSerializer(read_only=True)
    nombre_presentacion = serializers.SerializerMethodField()
    costo = serializers.DecimalField(source='costo_presentacion', max_digits=15, decimal_places=4, read_only=True)
    margen = serializers.DecimalField(source='margen_ganancia_porcentaje', max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = PresentacionProducto
        fields = [
            'id', 
            'producto', 
            'unidad_medida', 
            'factor_conversion', 
            'precio_venta_principal', 
            'nombre_presentacion',
            'costo',
            'margen'
        ]

    def get_nombre_presentacion(self, obj):
        factor = int(obj.factor_conversion) if obj.factor_conversion % 1 == 0 else float(obj.factor_conversion)
        if obj.unidad_medida:
            return f"{obj.unidad_medida.nombre} (x{factor})"
        return f"x{factor}"

# --- SERIALIZADORES DE TRANSACCIÓN (Para recibir desde el POS) ---

class DetalleVentaSerializer(serializers.ModelSerializer):
    presentacion_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = DetalleVenta
        fields = [
            'presentacion_id', 'cantidad_presentacion', 
            'precio_unitario_aplicado', 'porcentaje_impuesto_aplicado', 'subtotal'
        ]

class PagoVentaSerializer(serializers.ModelSerializer):
    metodo_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = PagoVenta
        fields = [
            'metodo_id', 
            'monto_pagado', 
            'monto_equivalente_principal', 
            'tasa_cambio_pago', 
            'referencia'
        ]

class VentaSerializer(serializers.ModelSerializer):
    detalles = DetalleVentaSerializer(many=True, write_only=True)
    pagos = PagoVentaSerializer(many=True, write_only=True, required=False)
    cliente_id = serializers.IntegerField(write_only=True)
    almacen_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = Venta
        fields = [
            'cliente_id', 
            'almacen_id', 
            'tipo', 
            'tasa_cambio_historica',
            'subtotal_principal', 
            'total_impuestos_principal', 
            'total_principal', 
            'total_secundaria', 
            'detalles', 
            'pagos'
        ]

    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles')
        pagos_data = validated_data.pop('pagos', [])
        cliente_id = validated_data.pop('cliente_id')
        almacen_id = validated_data.pop('almacen_id')
        usuario = self.context['request'].user

        sesion_activa = SesionCaja.objects.filter(usuario=usuario, estado='ABIERTA').first()
        if not sesion_activa:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Acción denegada: Debes abrir la caja antes de procesar ventas.")

        from django.utils import timezone
        hoy = timezone.localtime().date()
        fecha_apertura_dia = timezone.localtime(sesion_activa.fecha_apertura).date()

        if fecha_apertura_dia < hoy:
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Acción denegada: Tienes un turno abierto de ayer. Ciérralo antes de vender hoy.")

        venta = Venta.objects.create(
            cliente_id=cliente_id,
            almacen_id=almacen_id,
            usuario=usuario,
            sesion_caja=sesion_activa,
            **validated_data
        )

        for detalle_data in detalles_data:
            DetalleVenta.objects.create(
                venta=venta,
                presentacion_id=detalle_data['presentacion_id'],
                cantidad_presentacion=detalle_data['cantidad_presentacion'],
                precio_unitario_aplicado=detalle_data['precio_unitario_aplicado'],
                porcentaje_impuesto_aplicado=detalle_data['porcentaje_impuesto_aplicado'],
                subtotal=detalle_data['subtotal']
            )

        for pago_data in pagos_data:
            PagoVenta.objects.create(
                venta=venta,
                metodo_id=pago_data['metodo_id'],
                monto_pagado=pago_data['monto_pagado'],
                monto_equivalente_principal=pago_data['monto_equivalente_principal'],
                tasa_cambio_pago=pago_data['tasa_cambio_pago'],
                referencia=pago_data.get('referencia', '')
            )

        return venta

# --- SERIALIZADORES DE COMPRAS ---

class DetalleCompraSerializer(serializers.ModelSerializer):
    presentacion_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = DetalleCompra
        fields = [
            'presentacion_id', 'cantidad_presentacion', 
            'precio_unitario_aplicado', 'porcentaje_impuesto_aplicado', 'subtotal'
        ]

class CompraSerializer(serializers.ModelSerializer):
    detalles = DetalleCompraSerializer(many=True, write_only=True)
    proveedor_id = serializers.IntegerField(write_only=True)
    almacen_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = Compra
        fields = [
            'proveedor_id', 'almacen_id', 'tipo', 'tasa_cambio_historica',
            'subtotal_principal', 'total_impuestos_principal', 
            'total_principal', 'total_secundaria', 'detalles'
        ]

    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles')
        proveedor_id = validated_data.pop('proveedor_id')
        almacen_id = validated_data.pop('almacen_id')
        usuario = self.context['request'].user

        compra = Compra.objects.create(
            proveedor_id=proveedor_id,
            almacen_id=almacen_id,
            usuario=usuario,
            **validated_data
        )

        for detalle_data in detalles_data:
            DetalleCompra.objects.create(
                compra=compra,
                presentacion_id=detalle_data['presentacion_id'],
                cantidad_presentacion=detalle_data['cantidad_presentacion'],
                precio_unitario_aplicado=detalle_data['precio_unitario_aplicado'],
                porcentaje_impuesto_aplicado=detalle_data['porcentaje_impuesto_aplicado'],
                subtotal=detalle_data['subtotal']
            )

        return compra

class PagoCuentaCobrarSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoCuentaCobrar
        fields = [
            'cuenta', 'monto_abono_principal', 'monto_entregado_secundaria', 
            'tasa_cambio_pago', 'referencia'
        ]

    def create(self, validated_data):
        usuario = self.context['request'].user
        pago = PagoCuentaCobrar.objects.create(
            usuario=usuario,
            **validated_data
        )
        return pago

class AbonoMasivoSerializer(serializers.Serializer):
    cliente_id = serializers.IntegerField(required=True)
    tasa_cambio = serializers.DecimalField(max_digits=15, decimal_places=2, required=False, allow_null=True)
    guardar_saldo_favor = serializers.BooleanField(default=False)

    pagos = serializers.ListField(
        child=serializers.DictField(
            child=serializers.CharField(),
            allow_empty=False
        ),
        allow_empty=False,
        min_length=1
    )

    def validate_pagos(self, value):
        for i, pago in enumerate(value):
            if 'metodo_id' not in pago:
                raise serializers.ValidationError(f"El pago #{i+1} no tiene 'metodo_id'.")
            if 'monto_pagado' not in pago:
                raise serializers.ValidationError(f"El pago #{i+1} no tiene 'monto_pagado'.")
            try:
                float(pago['monto_pagado'])
            except (ValueError, TypeError):
                raise serializers.ValidationError(f"El pago #{i+1} tiene un monto inválido.")
        return value

    def validate(self, data):
        tasa = data.get('tasa_cambio')
        return data

class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Proveedor
        fields = ['id', 'nombre', 'documento', 'telefono', 'limite_credito']

class PagoCuentaPagarSerializer(serializers.ModelSerializer):
    class Meta:
        model = PagoCuentaPagar
        fields = ['cuenta', 'monto_abono_principal', 'monto_entregado_secundaria', 'tasa_cambio_pago', 'referencia']

    def create(self, validated_data):
        usuario = self.context['request'].user
        pago = PagoCuentaPagar.objects.create(
            usuario=usuario,
            **validated_data
        )
        return pago

class ConceptoEgresoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConceptoEgreso
        fields = ['id', 'nombre', 'tipo']

class EgresoCajaSerializer(serializers.ModelSerializer):
    class Meta:
        model = EgresoCaja
        fields = [
            'concepto', 'monto_extraido', 'moneda_extraida', 
            'monto_equivalente_principal', 'tasa_cambio_momento', 'observacion'
        ]

    def create(self, validated_data):
        usuario = self.context['request'].user
        sesion = SesionCaja.objects.filter(usuario=usuario, estado='ABIERTA').first()

        if not sesion:
            raise serializers.ValidationError("No tienes una sesión de caja abierta.")

        monto_solicitado_usd = validated_data.get('monto_equivalente_principal', Decimal('0.00'))
        disponible_usd = (sesion.fondo_inicial_principal + sesion.total_ventas_principal) - sesion.total_egresos_caja_principal

        if monto_solicitado_usd > disponible_usd:
            raise serializers.ValidationError(
                f"Fondos insuficientes en la gaveta. Solo tienes disponible: ${disponible_usd:.2f}"
            )

        return EgresoCaja.objects.create(
            sesion_caja=sesion,
            usuario=usuario,
            **validated_data
        )

class DetalleEgresoInventarioSerializer(serializers.ModelSerializer):
    presentacion_id = serializers.IntegerField()

    class Meta:
        model = DetalleEgresoInventario
        fields = ['presentacion_id', 'cantidad', 'costo_unitario_aplicado', 'subtotal_costo']

class EgresoInventarioSerializer(serializers.ModelSerializer):
    detalles = DetalleEgresoInventarioSerializer(many=True)

    class Meta:
        model = EgresoInventario
        fields = ['concepto', 'almacen', 'observacion', 'detalles']

    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles')
        usuario = self.context['request'].user

        total_costo = sum(Decimal(str(d['subtotal_costo'])) for d in detalles_data)

        egreso = EgresoInventario.objects.create(
            usuario=usuario,
            total_costo_principal=total_costo,
            **validated_data
        )

        for detalle in detalles_data:
            DetalleEgresoInventario.objects.create(egreso=egreso, **detalle)

        return egreso

class BorradorFacturaSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True)
    cajero_nombre = serializers.CharField(source='cajero.username', read_only=True)

    class Meta:
        model = BorradorFactura
        fields = ['id', 'nombre', 'carrito_json', 'cliente', 'cliente_nombre', 'cajero_nombre',
                  'total_principal', 'total_secundaria', 'tasa_cambio', 'creado_el']
                  
# ==============================================================================
# SERIALIZADORES DE RUTAS DE MERCADO
# ==============================================================================

class RutaMercadoDetalleSerializer(serializers.ModelSerializer):
    presentacion = serializers.PrimaryKeyRelatedField(read_only=True)
    nombre_producto = serializers.CharField(source='presentacion.producto.nombre', read_only=True)
    nombre_presentacion = serializers.SerializerMethodField()
    presentacion_id = serializers.IntegerField(write_only=True)
    cantidad_vendida = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    subtotal_bs = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)
    subtotal_usd = serializers.DecimalField(max_digits=15, decimal_places=2, read_only=True)

    class Meta:
        model = RutaMercadoDetalle
        fields = [
            'id', 'presentacion', 'presentacion_id', 'nombre_producto', 'nombre_presentacion',
            'cantidad_salida', 'cantidad_entrada', 'cantidad_vendida',
            'precio_venta_bs', 'subtotal_bs', 'subtotal_usd'
        ]


class RutaMercadoCreditoSerializer(serializers.ModelSerializer):
    cliente = serializers.PrimaryKeyRelatedField(read_only=True)
    cliente_nombre = serializers.CharField(source='cliente.nombre', read_only=True)
    cliente_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = RutaMercadoCredito
        fields = ['id', 'cliente', 'cliente_id', 'cliente_nombre', 'monto_bs', 'descripcion', 'cuenta_cobrar']


class RutaMercadoPagoSerializer(serializers.ModelSerializer):
    metodo = serializers.PrimaryKeyRelatedField(read_only=True)
    metodo_nombre = serializers.CharField(source='metodo.nombre', read_only=True)
    metodo_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = RutaMercadoPago
        fields = ['id', 'metodo', 'metodo_id', 'metodo_nombre', 'monto_bs', 'monto_usd_equivalente', 'referencia']


class RutaMercadoGastoSerializer(serializers.ModelSerializer):
    concepto = serializers.PrimaryKeyRelatedField(read_only=True)
    concepto_nombre = serializers.CharField(source='concepto.nombre', read_only=True)
    concepto_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = RutaMercadoGasto
        fields = ['id', 'concepto', 'concepto_id', 'concepto_nombre', 'monto_bs', 'descripcion']

class RutaMercadoSerializer(serializers.ModelSerializer):
    detalles = RutaMercadoDetalleSerializer(many=True, required=False)
    creditos = RutaMercadoCreditoSerializer(many=True, required=False)
    pagos = RutaMercadoPagoSerializer(many=True, required=False)
    gastos = RutaMercadoGastoSerializer(many=True, required=False)
    usuario_nombre = serializers.CharField(source='usuario.username', read_only=True)

    class Meta:
        model = RutaMercado
        fields = [
            'id', 'fecha', 'usuario', 'usuario_nombre', 'estado', 'almacen', 'tasa_cambio',
            'total_venta_bs', 'total_venta_usd',
            'total_efectivo_bs', 'total_pago_movil_bs', 'total_punto_venta_bs',
            'total_cobranzas_bs', 'total_creditos_bs', 'total_gastos_bs',
            'recaudado_esperado_bs', 'recaudado_real_bs', 'diferencia_bs',
            'observacion',
            'detalles', 'creditos', 'pagos', 'gastos'
        ]
        read_only_fields = [
            'usuario',  # <-- NUEVO: el backend lo inyecta, no el frontend
            'total_venta_bs', 'total_venta_usd',
            'total_efectivo_bs', 'total_pago_movil_bs', 'total_punto_venta_bs',
            'total_creditos_bs', 'total_gastos_bs',
            'recaudado_esperado_bs', 'recaudado_real_bs', 'diferencia_bs'
        ]

    def get_nombre_presentacion(self, obj):
        factor = int(obj.presentacion.factor_conversion) if obj.presentacion.factor_conversion % 1 == 0 else float(obj.presentacion.factor_conversion)
        if obj.presentacion.unidad_medida:
            return f"{obj.presentacion.unidad_medida.nombre} (x{factor})"
        return f"x{factor}"
    
    def create(self, validated_data):
        detalles_data = validated_data.pop('detalles', [])
        creditos_data = validated_data.pop('creditos', [])
        pagos_data = validated_data.pop('pagos', [])
        gastos_data = validated_data.pop('gastos', [])

        # >>> NUEVO: Inyectar usuario desde el request en el contexto <<<
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            validated_data['usuario'] = request.user

        ruta = RutaMercado.objects.create(**validated_data)

        for d in detalles_data:
            RutaMercadoDetalle.objects.create(ruta=ruta, **d)
        for c in creditos_data:
            RutaMercadoCredito.objects.create(ruta=ruta, **c)
        for p in pagos_data:
            RutaMercadoPago.objects.create(ruta=ruta, **p)
        for g in gastos_data:
            RutaMercadoGasto.objects.create(ruta=ruta, **g)

        ruta.calcular_totales()
        ruta.save()
        return ruta

    def update(self, instance, validated_data):
        es_cerrada = instance.estado == 'CERRADA'

        detalles_data = validated_data.pop('detalles', None)
        creditos_data = validated_data.pop('creditos', None)
        pagos_data = validated_data.pop('pagos', None)
        gastos_data = validated_data.pop('gastos', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if not es_cerrada and detalles_data is not None:
            instance.detalles.all().delete()
            for d in detalles_data:
                RutaMercadoDetalle.objects.create(ruta=instance, **d)

        if creditos_data is not None:
            instance.creditos.all().delete()
            for c in creditos_data:
                RutaMercadoCredito.objects.create(ruta=instance, **c)

        if pagos_data is not None:
            instance.pagos.all().delete()
            for p in pagos_data:
                RutaMercadoPago.objects.create(ruta=instance, **p)

        if gastos_data is not None:
            instance.gastos.all().delete()
            for g in gastos_data:
                RutaMercadoGasto.objects.create(ruta=instance, **g)

        instance.calcular_totales()
        instance.save()
        return instance


class ImportarExcelRutaSerializer(serializers.Serializer):
    """Serializer para recibir el archivo Excel y devolver JSON pre-llenado."""
    archivo = serializers.FileField()
    tasa_cambio = serializers.DecimalField(max_digits=15, decimal_places=2, required=False)


# ==============================================================================
# SERIALIZADORES DE TOMA FÍSICA Y AJUSTES
# ==============================================================================

class DetalleTomaFisicaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source='producto.nombre', read_only=True)
    producto_codigo = serializers.CharField(source='producto.codigo_base', read_only=True)
    unidad_medida = serializers.CharField(source='producto.unidad_medida.sigla', read_only=True)
    diferencia = serializers.DecimalField(max_digits=15, decimal_places=4, read_only=True)
    subtotal_diferencia = serializers.DecimalField(max_digits=15, decimal_places=4, read_only=True)
    presentacion_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = DetalleTomaFisica
        fields = [
            'id', 'producto', 'producto_nombre', 'producto_codigo', 'unidad_medida',
            'presentacion', 'presentacion_id',
            'stock_teorico', 'stock_fisico', 'diferencia',
            'costo_unitario_snapshot', 'subtotal_diferencia', 'observacion_linea'
        ]


class TomaFisicaListSerializer(serializers.ModelSerializer):
    almacen_nombre = serializers.CharField(source='almacen.nombre', read_only=True)
    usuario_nombre = serializers.CharField(source='usuario.username', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    estado_display = serializers.CharField(source='get_estado_display', read_only=True)
    cantidad_lineas = serializers.SerializerMethodField()
    lineas_pendientes = serializers.SerializerMethodField()

    class Meta:
        model = TomaFisica
        fields = [
            'id', 'almacen', 'almacen_nombre', 'usuario', 'usuario_nombre',
            'fecha_creacion', 'fecha_cierre', 'estado', 'estado_display',
            'tipo', 'tipo_display', 'cantidad_muestra',
            'total_esperado', 'total_fisico', 'diferencia_total',
            'cantidad_lineas', 'lineas_pendientes', 'observacion'
        ]

    def get_cantidad_lineas(self, obj):
        return obj.detalles.count()

    def get_lineas_pendientes(self, obj):
        # Líneas donde stock_fisico es 0 (asumiendo que 0 = no contado aún)
        # O mejor: líneas donde stock_fisico no ha sido modificado del default
        return obj.detalles.filter(stock_fisico=Decimal('0.0000')).count()


class TomaFisicaDetalleSerializer(serializers.ModelSerializer):
    almacen_nombre = serializers.CharField(source='almacen.nombre', read_only=True)
    usuario_nombre = serializers.CharField(source='usuario.username', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    estado_display = serializers.CharField(source='get_estado_display', read_only=True)
    detalles = DetalleTomaFisicaSerializer(many=True, read_only=True)
    resumen = serializers.SerializerMethodField()

    class Meta:
        model = TomaFisica
        fields = [
            'id', 'almacen', 'almacen_nombre', 'usuario', 'usuario_nombre',
            'fecha_creacion', 'fecha_cierre', 'estado', 'estado_display',
            'tipo', 'tipo_display', 'cantidad_muestra',
            'total_esperado', 'total_fisico', 'diferencia_total',
            'observacion', 'detalles', 'resumen'
        ]

    def get_resumen(self, obj):
        detalles = obj.detalles.all()
        faltantes = sum(1 for d in detalles if d.diferencia < 0)
        sobrantes = sum(1 for d in detalles if d.diferencia > 0)
        cuadrados = sum(1 for d in detalles if d.diferencia == 0)
        pendientes = sum(1 for d in detalles if d.stock_fisico == Decimal('0.0000'))

        valor_faltantes = sum(d.subtotal_diferencia for d in detalles if d.diferencia < 0)
        valor_sobrantes = sum(d.subtotal_diferencia for d in detalles if d.diferencia > 0)

        return {
            'total_lineas': len(detalles),
            'faltantes': faltantes,
            'sobrantes': sobrantes,
            'cuadrados': cuadrados,
            'pendientes': pendientes,
            'valor_faltantes_usd': float(valor_faltantes),
            'valor_sobrantes_usd': float(valor_sobrantes),
            'valor_neto_diferencia_usd': float(valor_sobrantes - valor_faltantes)
        }


class CrearTomaFisicaSerializer(serializers.Serializer):
    almacen_id = serializers.IntegerField(required=True)
    tipo = serializers.ChoiceField(choices=TomaFisica.TIPOS, default='COMPLETO')
    cantidad_muestra = serializers.IntegerField(required=False, default=10, min_value=1)
    productos_ids = serializers.ListField(
        child=serializers.IntegerField(), required=False, allow_empty=True
    )
    observacion = serializers.CharField(required=False, allow_blank=True)


class ActualizarConteoSerializer(serializers.Serializer):
    detalles = serializers.ListField(
        child=serializers.DictField(),
        allow_empty=False,
        min_length=1
    )

    def validate_detalles(self, value):
        for i, item in enumerate(value):
            if 'detalle_id' not in item:
                raise serializers.ValidationError(f"El item #{i+1} no tiene 'detalle_id'.")
            if 'stock_fisico' not in item:
                raise serializers.ValidationError(f"El item #{i+1} no tiene 'stock_fisico'.")
            try:
                float(item['stock_fisico'])
            except (ValueError, TypeError):
                raise serializers.ValidationError(f"El item #{i+1} tiene stock_fisico inválido.")
        return value


class DetalleAjusteInventarioSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(source='producto.nombre', read_only=True)
    producto_codigo = serializers.CharField(source='producto.codigo_base', read_only=True)

    class Meta:
        model = DetalleAjusteInventario
        fields = [
            'id', 'producto', 'producto_nombre', 'producto_codigo',
            'cantidad_ajustada', 'costo_unitario_aplicado',
            'subtotal_costo', 'tipo_ajuste'
        ]


class AjusteInventarioSerializer(serializers.ModelSerializer):
    almacen_nombre = serializers.CharField(source='almacen.nombre', read_only=True)
    usuario_nombre = serializers.CharField(source='usuario.username', read_only=True)
    toma_fisica_id = serializers.IntegerField(source='toma_fisica.id', read_only=True)
    detalles = DetalleAjusteInventarioSerializer(many=True, read_only=True)

    class Meta:
        model = AjusteInventario
        fields = [
            'id', 'toma_fisica', 'toma_fisica_id', 'almacen', 'almacen_nombre',
            'usuario', 'usuario_nombre', 'fecha', 'estado',
            'total_costo_ajuste', 'observacion', 'detalles'
        ]
