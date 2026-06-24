from decimal import Decimal
from rest_framework import serializers
from .models import (Producto, PresentacionProducto, Venta, DetalleVenta, SesionCaja,
    PagoCuentaCobrar,MetodoPago, PagoVenta, Cliente, Proveedor, PagoCuentaPagar, ConfiguracionGlobal,
    ConceptoEgreso, EgresoCaja, EgresoInventario, DetalleEgresoInventario, SesionCaja, ConceptoEgreso,
    Compra, DetalleCompra, ConfiguracionGlobal, ConceptoEgreso, EgresoCaja, EgresoInventario, DetalleEgresoInventario
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
    class Meta:
        model = Cliente
        fields = ['id', 'nombre', 'documento', 'telefono', 'limite_credito', 'saldo_a_favor', 'deuda_inicial']

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
    costo = serializers.DecimalField(source='costo_presentacion', max_digits=15, decimal_places=2, read_only=True)
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
