from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from decimal import Decimal
from django.db import transaction
from django.utils import timezone

# ==============================================================================
# 1. CONFIGURACIÓN Y CATÁLOGOS
# ==============================================================================

class ConfiguracionGlobal(models.Model):
    moneda_principal = models.CharField(max_length=10, default='USD', help_text="Ej. USD")
    moneda_secundaria = models.CharField(max_length=10, default='BS', help_text="Ej. BS")
    tasa_cambio_actual = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('1.00'))
    permitir_stock_negativo = models.BooleanField(default=False, help_text="Permite vender sin stock disponible")

    # >>> NUEVO CAMPO DE SEGURIDAD PARA EL POS <<<
    cajero_puede_cambiar_precio = models.BooleanField(
        default=False, 
        help_text="Permite a los usuarios con rol 'Cajero' modificar el precio de los productos en el POS"
    )


    class Meta:
        verbose_name = "Configuración Global"
        verbose_name_plural = "Configuraciones Globales"

    def save(self, *args, **kwargs):
        if self.__class__.objects.count() > 0 and not self.pk:
            raise ValidationError("Solo puede existir una instancia de ConfiguracionGlobal")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Configuración Tasa: {self.tasa_cambio_actual} {self.moneda_secundaria}/{self.moneda_principal}"

class Impuesto(models.Model):
    nombre = models.CharField(max_length=50, unique=True, help_text="Ej. IVA, Exento")
    porcentaje = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'), help_text="Ej. 16.00")

    def __str__(self):
        return f"{self.nombre} ({self.porcentaje}%)"

class UnidadMedida(models.Model):
    nombre = models.CharField(max_length=50, unique=True, help_text="Ej. Kilogramo, Unidad")
    sigla = models.CharField(max_length=10, unique=True, help_text="Ej. kg, und")

    def __str__(self):
        return f"{self.nombre} ({self.sigla})"

class Almacen(models.Model):
    nombre = models.CharField(max_length=100)
    direccion = models.TextField(blank=True, null=True)
    activo = models.BooleanField(default=True)

    class Meta:
        verbose_name_plural = "Almacenes"

    def __str__(self):
        return self.nombre


# ==============================================================================
# 2. USUARIOS Y ENTIDADES
# ==============================================================================

class Usuario(AbstractUser):
    ROLES = (
        ('ADMIN', 'Administrador'),
        ('GERENTE', 'Gerente'),
        ('CAJERO', 'Cajero'),
    )
    rol = models.CharField(max_length=15, choices=ROLES, default='CAJERO')

    def __str__(self):
        return f"{self.username} - {self.get_rol_display()}"

class EntidadComercial(models.Model):
    """
    Clase base abstracta para evitar repetir código entre Cliente y Proveedor.
    """
    nombre = models.CharField(max_length=150)
    documento = models.CharField(max_length=50, unique=True, help_text="RIF, Cédula, NIT, etc.")
    telefono = models.CharField(max_length=20, blank=True, null=True)
    direccion = models.TextField(blank=True, null=True)
    limite_credito = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        abstract = True

class Cliente(EntidadComercial):
    # >>> NUEVO: Saldo a favor para abonos que exceden la deuda <<<
    saldo_a_favor = models.DecimalField(
        max_digits=15, decimal_places=2, default=Decimal('0.00'),
        help_text="Saldo positivo acumulado por abonos superiores a la deuda. Se aplica automáticamente en próximas compras a crédito."
    )

    def __str__(self):
        return f"Cliente: {self.nombre}"

class Proveedor(EntidadComercial):
    def __str__(self):
        return f"Proveedor: {self.nombre}"


# ==============================================================================
# 3. INVENTARIO AVANZADO Y PRESENTACIONES
# ==============================================================================

class Categoria(models.Model):
    nombre = models.CharField(max_length=100, unique=True)

    def __str__(self):
        return self.nombre

class Producto(models.Model):
    """
    Catálogo central de productos. Aquí NO se guarda el stock ni el precio de venta final,
    solo el costo de la unidad mínima (base).
    """
    codigo_base = models.CharField(max_length=50, unique=True)
    nombre = models.CharField(max_length=200)
    categoria = models.ForeignKey(Categoria, on_delete=models.RESTRICT)
    unidad_medida = models.ForeignKey(UnidadMedida, on_delete=models.RESTRICT, help_text="Unidad mínima de control")
    impuesto = models.ForeignKey(Impuesto, on_delete=models.RESTRICT)
    costo_base_moneda_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    def __str__(self):
        return f"{self.codigo_base} - {self.nombre}"

class PresentacionProducto(models.Model):
    """
    Variantes de empaque o presentaciones para la compra/venta (ej. Unidad, Caja x 12, Bulto x 24).
    """
    producto = models.ForeignKey(Producto, on_delete=models.CASCADE, related_name='presentaciones')
    unidad_medida = models.ForeignKey('UnidadMedida', on_delete=models.RESTRICT, null=True, help_text="Ej. Caja, Bulto, Unidad")
    factor_conversion = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('1.00'))
    precio_venta_principal = models.DecimalField(max_digits=15, decimal_places=2)

    class Meta:
        verbose_name_plural = "Presentaciones de Productos"

    @property
    def precio_venta_secundaria(self):
        """
        Calcula dinámicamente el precio en la moneda débil (Ej. BS) 
        usando la tasa de cambio activa en este instante.
        """
        # Evitamos importaciones circulares en la cabecera
        from .models import ConfiguracionGlobal 

        config = ConfiguracionGlobal.objects.first()
        if config and self.precio_venta_principal:
            return self.precio_venta_principal * config.tasa_cambio_actual
        return Decimal('0.00')

    @property
    def costo_presentacion(self):
        """Calcula el costo dinámico de esta presentación en base al costo del producto."""
        if self.producto and self.producto.costo_base_moneda_principal:
            return self.producto.costo_base_moneda_principal * self.factor_conversion
        return Decimal('0.00')

    @property
    def margen_ganancia_porcentaje(self):
        # 1. PROTECCIÓN: Si es una fila vacía del Admin, devolvemos 0
        if self.precio_venta_principal is None or self.factor_conversion is None:
            return Decimal('0.00')

        # Opcional: También asegurarnos de que el producto exista (por si acaso)
        if not self.producto_id or self.producto.costo_base_moneda_principal is None:
            return Decimal('0.00')

        # 2. Tu código original se mantiene igual a partir de aquí
        costo = self.producto.costo_base_moneda_principal * self.factor_conversion
        ganancia_neta = self.precio_venta_principal - costo

        # Validación extra para evitar división por cero
        if costo == Decimal('0.00'):
            return Decimal('100.00')

        return (ganancia_neta / costo) * Decimal('100.00')

    def __str__(self):
        return f"{self.producto.nombre} - {self.unidad_medida.sigla} (x{self.factor_conversion})"

class InventarioAlmacen(models.Model):
    producto = models.ForeignKey(Producto, on_delete=models.CASCADE, related_name='stock_por_almacen')
    almacen = models.ForeignKey(Almacen, on_delete=models.CASCADE)
    stock_actual_unidades_base = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        unique_together = ('producto', 'almacen')
        verbose_name_plural = "Inventarios en Almacenes"

    def __str__(self):
        # >>> CORREGIDO <<<
        return f"{self.producto.nombre} en {self.almacen.nombre}: {self.stock_actual_unidades_base} {self.producto.unidad_medida.sigla}"
# ==============================================================================
# 3.5. CONTROL DE CAJA Y TURNOS
# ==============================================================================

class SesionCaja(models.Model):
    ESTADOS_SESION = (
        ('ABIERTA', 'Abierta'),
        ('CERRADA', 'Cerrada'),
    )

    usuario = models.ForeignKey(Usuario, on_delete=models.RESTRICT, help_text="Cajero responsable")
    fecha_apertura = models.DateTimeField(auto_now_add=True)
    fecha_cierre = models.DateTimeField(blank=True, null=True)
    estado = models.CharField(max_length=15, choices=ESTADOS_SESION, default='ABIERTA')

    # Fondos con los que el cajero inicia el turno (Sencillo/Cambio)
    fondo_inicial_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    fondo_inicial_secundaria = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    # Lo que el cajero declara tener físicamente al cerrar el turno (Ciego)
    reporte_cierre_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    reporte_cierre_secundaria = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        verbose_name_plural = "Sesiones de Caja"

    def __str__(self):
        return f"Sesión #{self.id} - {self.usuario.username} ({self.estado})"

    @property
    def total_ventas_principal(self):
        """Calcula el total vendido en moneda principal durante esta sesión."""
        ventas = self.ventas.filter(estado='PROCESADA')
        total = sum(venta.total_principal for venta in ventas)
        return total

    # ==============================================================================
    # UBICACIÓN CORRECTA: ESTAS PROPERTIES DEBEN IR AQUÍ ADENTRO
    # ==============================================================================
    @property
    def total_egresos_caja_principal(self):
        """Suma de todas las salidas de efectivo en esta sesión."""
        return self.egresos_efectivo.aggregate(
            total=models.Sum('monto_equivalente_principal')
        )['total'] or Decimal('0.00')

    @property
    def descuadre_principal(self):
        """
        Nueva fórmula: Físico - (Fondo + Ventas - Gastos)
        """
        esperado = (self.fondo_inicial_principal + self.total_ventas_principal) - self.total_egresos_caja_principal
        return self.reporte_cierre_principal - esperado

# ==============================================================================
# 4. TRANSACCIONES (VENTAS Y COMPRAS)
# ==============================================================================
class MetodoPago(models.Model):
    nombre = models.CharField(max_length=50, unique=True, help_text="Ej. Efectivo USD, Pago Móvil, Zelle")
    MONEDAS = (('PRINCIPAL', 'Moneda Principal (USD)'), ('SECUNDARIA', 'Moneda Secundaria (BS)'))
    moneda_referencia = models.CharField(max_length=15, choices=MONEDAS, default='PRINCIPAL')
    activo = models.BooleanField(default=True)

    def __str__(self):
        return self.nombre

class TransaccionBase(models.Model):
    """
    Modelo abstracto para reutilizar la lógica de cabeceras de facturación.
    """
    TIPOS = (
        ('CONTADO', 'Contado'),
        ('CREDITO', 'Crédito'),
    )
    ESTADOS = (
        ('BORRADOR', 'Borrador'),
        ('PROCESADA', 'Procesada'),
        ('ANULADA', 'Anulada'),
    )
    # Permitimos editar la fecha en el admin; por defecto toma "ahora".
    fecha = models.DateTimeField(default=timezone.now)
    usuario = models.ForeignKey(Usuario, on_delete=models.RESTRICT)
    almacen = models.ForeignKey(Almacen, on_delete=models.RESTRICT, help_text="Almacén de origen o destino")
    tipo = models.CharField(max_length=10, choices=TIPOS, default='CONTADO')
    estado = models.CharField(max_length=15, choices=ESTADOS, default='BORRADOR')

    # Datos Críticos Financieros (Fotos del momento de la transacción)
    tasa_cambio_historica = models.DecimalField(max_digits=15, decimal_places=2)
    subtotal_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    total_impuestos_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    total_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    total_secundaria = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))

    class Meta:
        abstract = True

class Venta(TransaccionBase):
    cliente = models.ForeignKey(Cliente, on_delete=models.RESTRICT)

    # NUEVO CAMPO: Conecta la venta con el turno del cajero
    # Usamos related_name='ventas' para poder hacer self.ventas.filter() en el cálculo de arriba
    sesion_caja = models.ForeignKey(SesionCaja, on_delete=models.RESTRICT, related_name='ventas', null=True, blank=True)

    def __str__(self):
        return f"Venta #{self.id} - {self.cliente.nombre} - {self.total_principal}"

    def procesar_venta(self):
        from .models import ConfiguracionGlobal, CuentaPorCobrar
        from django.db.models import Sum # Importante para sumar la deuda

        with transaction.atomic():
            if self.estado != 'BORRADOR':
                raise ValueError("Solo se pueden procesar ventas en estado BORRADOR.")

            config = ConfiguracionGlobal.objects.first()
            permitir_negativo = config.permitir_stock_negativo if config else False

            # 1. Descontar del inventario
            for detalle in self.detalles.all():
                cantidad_descontar_base = detalle.cantidad_presentacion * detalle.presentacion.factor_conversion

                inventario, created = InventarioAlmacen.objects.get_or_create(
                    producto=detalle.presentacion.producto,
                    almacen=self.almacen,
                    defaults={'stock_actual_unidades_base': Decimal('0.00')}
                )

                if not permitir_negativo and inventario.stock_actual_unidades_base < cantidad_descontar_base:
                    raise ValueError(f"Stock insuficiente para el producto '{detalle.presentacion.producto.nombre}'. Disponible: {inventario.stock_actual_unidades_base}")

                inventario.stock_actual_unidades_base -= cantidad_descontar_base
                inventario.save()

            # 2. Calcular Abono Inicial de los pagos registrados en la caja
            abono_inicial = sum(pago.monto_equivalente_principal for pago in self.pagos.all())

            # 3. Validaciones y Generación de Cuenta por Cobrar si es a CRÉDITO
            if self.tipo == 'CREDITO':
                cliente = self.cliente

                # >>> NUEVO: Aplicar saldo a favor si existe <<<
                saldo_favor_usado = Decimal('0.00')
                if cliente.saldo_a_favor > Decimal('0.00'):
                    if cliente.saldo_a_favor >= self.total_principal:
                        saldo_favor_usado = self.total_principal
                        cliente.saldo_a_favor -= self.total_principal
                        abono_inicial += self.total_principal  # El saldo a favor cubre todo
                    else:
                        saldo_favor_usado = cliente.saldo_a_favor
                        abono_inicial += cliente.saldo_a_favor
                        cliente.saldo_a_favor = Decimal('0.00')
                    cliente.save(update_fields=['saldo_a_favor'])

                # Regla 1: Bloqueo total si el límite es -1
                if cliente.limite_credito == Decimal('-1.00'):
                    raise ValueError(f"El cliente '{cliente.nombre}' tiene restringido el crédito.")

                # Regla 2: Validar límite si es mayor a 0.00 (0.00 significa sin límite)
                if cliente.limite_credito > Decimal('0.00'):
                    # Sumamos el saldo pendiente de todas sus CxC activas
                    deuda_actual = CuentaPorCobrar.objects.filter(
                        cliente=cliente,
                        estado__in=['PENDIENTE', 'VENCIDA']
                    ).aggregate(total=Sum('saldo_pendiente'))['total'] or Decimal('0.00')

                    if (deuda_actual + self.total_principal) > cliente.limite_credito:
                        disponible = cliente.limite_credito - deuda_actual
                        raise ValueError(
                            f"Límite de crédito excedido. Deuda: ${deuda_actual:.2f}, "
                            f"Límite: ${cliente.limite_credito:.2f}. Disponible: ${disponible:.2f}"
                        )

                # Si pasa las reglas, se crea la cuenta
                saldo_restante = self.total_principal - abono_inicial
                estado_cxc = 'PAGADA' if saldo_restante <= Decimal('0.00') else 'PENDIENTE'

                cxc = CuentaPorCobrar.objects.create(
                    venta=self,
                    cliente=self.cliente,
                    monto_total=self.total_principal,
                    saldo_pendiente=saldo_restante,
                    estado=estado_cxc
                )

                # Opcional: Si el abono es > 0, registramos de una vez ese pago en el historial de la CxC
                if abono_inicial > 0:
                    from .models import PagoCuentaCobrar
                    PagoCuentaCobrar.objects.create(
                        cuenta=cxc,
                        usuario=self.usuario,
                        monto_abono_principal=abono_inicial,
                        tasa_cambio_pago=self.tasa_cambio_historica,
                        referencia="Abono inicial en caja" + (f" + Saldo a favor: ${saldo_favor_usado:.2f}" if saldo_favor_usado > 0 else "")
                    )

            # 4. Cambiar estado
            self.estado = 'PROCESADA'
            self.save()

    def anular_venta(self):
        """
        Anula la venta: reversa el inventario y elimina la CxC si existe.
        """
        with transaction.atomic():
            if self.estado != 'PROCESADA':
                raise ValueError("Solo se pueden anular ventas PROCESADAS.")

            # 1. Reversar inventario (Sumar lo que se había restado)
            for detalle in self.detalles.all():
                cantidad_reversar_base = detalle.cantidad_presentacion * detalle.presentacion.factor_conversion
                inventario = InventarioAlmacen.objects.get(
                    producto=detalle.presentacion.producto,
                    almacen=self.almacen
                )
                inventario.stock_actual_unidades_base += cantidad_reversar_base
                inventario.save()

            # 2. Eliminar o anular Cuenta por Cobrar
            if hasattr(self, 'cuentaporcobrar'):
                self.cuentaporcobrar.delete() # O cambiar su estado a 'ANULADA' según tu regla de negocio

            # 3. Cambiar estado
            self.estado = 'ANULADA'
            self.save()

class Compra(TransaccionBase):
    proveedor = models.ForeignKey(Proveedor, on_delete=models.RESTRICT)

    def __str__(self):
        return f"Compra #{self.id} - {self.proveedor.nombre} - {self.total_principal}"

    def _aplicar_movimientos_compra(self):
        """
        Lógica central de la compra:
        - Suma stock al inventario.
        - Crea CxP si es a crédito.
        No valida el estado; eso lo hace quien llame a este método.
        """
        # 1. Ingresar al inventario (Sumar)
        for detalle in self.detalles.all():
            cantidad_sumar_base = (
                detalle.cantidad_presentacion * detalle.presentacion.factor_conversion
            )

            inventario, created = InventarioAlmacen.objects.get_or_create(
                producto=detalle.presentacion.producto,
                almacen=self.almacen,
                defaults={"stock_actual_unidades_base": Decimal("0.00")},
            )

            inventario.stock_actual_unidades_base += cantidad_sumar_base
            inventario.save()

        # 2. Generar Cuenta por Pagar si es a CRÉDITO
        if self.tipo == "CREDITO":
            from .models import CuentaPorPagar

            CuentaPorPagar.objects.create(
                compra=self,
                proveedor=self.proveedor,
                monto_total=self.total_principal,
                saldo_pendiente=self.total_principal,
                estado="PENDIENTE",
            )

    def procesar_compra(self):
        """
        Procesa la entrada de mercancía: AUMENTA el inventario calculando las unidades base
        y genera la cuenta por pagar si es a crédito. Todo bajo transacción atómica.
        Se espera que se llame una sola vez.
        """
        with transaction.atomic():
            if self.estado != "BORRADOR":
                raise ValueError("Solo se pueden procesar compras en estado BORRADOR.")

            self._aplicar_movimientos_compra()

            # Cambiar estado
            self.estado = "PROCESADA"
            self.save()

    def anular_compra(self):
        """
        Anula la compra: REVERSA (resta) el inventario y elimina la CxP si existe.
        """
        from django.db import transaction

        with transaction.atomic():
            if self.estado != 'PROCESADA':
                raise ValueError("Solo se pueden anular compras PROCESADAS.")

            # 1. Reversar inventario (Restar lo que se había sumado)
            for detalle in self.detalles.all():
                cantidad_reversar_base = detalle.cantidad_presentacion * detalle.presentacion.factor_conversion
                inventario = InventarioAlmacen.objects.get(
                    producto=detalle.presentacion.producto,
                    almacen=self.almacen
                )
                inventario.stock_actual_unidades_base -= cantidad_reversar_base
                inventario.save()

            # 2. Eliminar o anular Cuenta por Pagar
            if hasattr(self, 'cuentaporpagar'):
                self.cuentaporpagar.delete()

            # 3. Cambiar estado
            self.estado = 'ANULADA'
            self.save()

class DetalleVenta(models.Model):
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name='detalles')
    presentacion = models.ForeignKey(PresentacionProducto, on_delete=models.RESTRICT)
    cantidad_presentacion = models.DecimalField(max_digits=15, decimal_places=2)
    precio_unitario_aplicado = models.DecimalField(max_digits=15, decimal_places=2)
    porcentaje_impuesto_aplicado = models.DecimalField(max_digits=15, decimal_places=2)
    subtotal = models.DecimalField(max_digits=15, decimal_places=2)

class DetalleCompra(models.Model):
    compra = models.ForeignKey(Compra, on_delete=models.CASCADE, related_name='detalles')
    presentacion = models.ForeignKey(PresentacionProducto, on_delete=models.RESTRICT)
    cantidad_presentacion = models.DecimalField(max_digits=15, decimal_places=2)
    precio_unitario_aplicado = models.DecimalField(max_digits=15, decimal_places=2)
    porcentaje_impuesto_aplicado = models.DecimalField(max_digits=15, decimal_places=2)
    subtotal = models.DecimalField(max_digits=15, decimal_places=2)

class PagoVenta(models.Model):
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name='pagos')
    metodo = models.ForeignKey(MetodoPago, on_delete=models.RESTRICT)
    monto_pagado = models.DecimalField(max_digits=15, decimal_places=2, help_text="Lo que entregó el cliente en la moneda del método")
    monto_equivalente_principal = models.DecimalField(max_digits=15, decimal_places=2, help_text="Equivalencia en USD para cuadrar")
    tasa_cambio_pago = models.DecimalField(max_digits=15, decimal_places=2)
    referencia = models.CharField(max_length=100, blank=True)

# ==============================================================================
# 5. CUENTAS Y CRÉDITOS
# ==============================================================================

class CuentaBase(models.Model):
    ESTADOS_CUENTA = (
        ('PENDIENTE', 'Pendiente'),
        ('PAGADA', 'Pagada'),
        ('VENCIDA', 'Vencida'),
    )
    monto_total = models.DecimalField(max_digits=15, decimal_places=2)
    saldo_pendiente = models.DecimalField(max_digits=15, decimal_places=2)
    estado = models.CharField(max_length=15, choices=ESTADOS_CUENTA, default='PENDIENTE')
    fecha_vencimiento = models.DateField(blank=True, null=True)

    class Meta:
        abstract = True

class CuentaPorCobrar(CuentaBase):
    venta = models.OneToOneField(Venta, on_delete=models.CASCADE)
    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE)

    def __str__(self):
        return f"CxC Venta #{self.venta.id} - Saldo: {self.saldo_pendiente}"

class CuentaPorPagar(CuentaBase):
    compra = models.OneToOneField(Compra, on_delete=models.CASCADE)
    proveedor = models.ForeignKey(Proveedor, on_delete=models.CASCADE)

    def __str__(self):
        return f"CxP Compra #{self.compra.id} - Saldo: {self.saldo_pendiente}"


# ==============================================================================
# 5.5. HISTORIAL DE PAGOS / ABONOS
# ==============================================================================

class PagoBase(models.Model):
    """
    Modelo abstracto para reutilizar la lógica de pagos a deudas.
    """
    fecha = models.DateTimeField(auto_now_add=True)
    # Cuánto de la deuda en moneda principal (ej. USD) se está cancelando con este abono
    monto_abono_principal = models.DecimalField(max_digits=15, decimal_places=2)
    # Cuánto entregó físicamente en moneda secundaria (ej. BS), si aplica
    monto_entregado_secundaria = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    # La tasa del día en que vino a pagar, vital para auditorías futuras
    tasa_cambio_pago = models.DecimalField(max_digits=15, decimal_places=2)
    referencia = models.CharField(max_length=100, blank=True, help_text="Ej. Efectivo, Zelle, Transferencia #123")

    class Meta:
        abstract = True

class PagoCuentaCobrar(PagoBase):
    cuenta = models.ForeignKey(CuentaPorCobrar, on_delete=models.CASCADE, related_name='pagos')
    usuario = models.ForeignKey(Usuario, on_delete=models.RESTRICT, help_text="Cajero que recibió el pago")

    def __str__(self):
        return f"Abono a CxC #{self.cuenta.id} - Monto: {self.monto_abono_principal}"

    def procesar_pago(self):
        """Aplica el abono a la cuenta del cliente y actualiza su estado."""
        from django.db import transaction
        with transaction.atomic():
            if self.cuenta.estado == 'PAGADA':
                raise ValueError("Esta cuenta ya está totalmente pagada.")

            if self.monto_abono_principal > self.cuenta.saldo_pendiente:
                raise ValueError("El monto del abono no puede ser mayor al saldo pendiente.")

            # Descontar el saldo
            self.cuenta.saldo_pendiente -= self.monto_abono_principal

            # Si el saldo llega a 0, cambiamos el estado
            if self.cuenta.saldo_pendiente <= Decimal('0.00'):
                self.cuenta.saldo_pendiente = Decimal('0.00')
                self.cuenta.estado = 'PAGADA'

            self.cuenta.save()

class PagoCuentaPagar(PagoBase):
    cuenta = models.ForeignKey(CuentaPorPagar, on_delete=models.CASCADE, related_name='pagos')
    usuario = models.ForeignKey(Usuario, on_delete=models.RESTRICT, help_text="Usuario que emitió el pago")

    def __str__(self):
        return f"Abono a CxP #{self.cuenta.id} - Monto: {self.monto_abono_principal}"

    def procesar_pago(self):
        """Aplica el abono a la deuda con el proveedor y actualiza el estado."""
        from django.db import transaction
        with transaction.atomic():
            if self.cuenta.estado == 'PAGADA':
                raise ValueError("Esta deuda ya está saldada.")

            if self.monto_abono_principal > self.cuenta.saldo_pendiente:
                raise ValueError("El pago no puede superar la deuda actual.")

            self.cuenta.saldo_pendiente -= self.monto_abono_principal

            if self.cuenta.saldo_pendiente <= Decimal('0.00'):
                self.cuenta.saldo_pendiente = Decimal('0.00')
                self.cuenta.estado = 'PAGADA'

            self.cuenta.save()

# nucleo/models.py

# ==============================================================================
# 6. MODELOS DE EGRESOS (GASTOS, DONACIONES Y CONSUMO)
# ==============================================================================

class ConceptoEgreso(models.Model):
    TIPOS = (
        ('OPERATIVO', 'Gasto Operativo (Servicios, Limpieza, etc)'),
        ('NOMINA', 'Pago de Nómina / Adelantos'),
        ('INTERNO', 'Consumo Interno (Uso del negocio)'),
        ('DONACION', 'Donación / Cortesía'),
        ('OTRO', 'Otro tipo de salida'),
    )
    nombre = models.CharField(max_length=100, unique=True)
    tipo = models.CharField(max_length=20, choices=TIPOS, default='OPERATIVO')
    activo = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Concepto de Egreso"
        verbose_name_plural = "Conceptos de Egresos"

    def __str__(self):
        return f"{self.nombre} ({self.get_tipo_display()})"

class EgresoCaja(models.Model):
    """Registro de salida de dinero físico de la gaveta."""
    sesion_caja = models.ForeignKey('SesionCaja', on_delete=models.CASCADE, related_name='egresos_efectivo')
    concepto = models.ForeignKey(ConceptoEgreso, on_delete=models.RESTRICT)
    usuario = models.ForeignKey('Usuario', on_delete=models.RESTRICT)
    fecha = models.DateTimeField(auto_now_add=True)

    # Monto en la moneda que se extrajo
    monto_extraido = models.DecimalField(max_digits=15, decimal_places=2)
    moneda_extraida = models.CharField(max_length=15, choices=(('PRINCIPAL', 'USD'), ('SECUNDARIA', 'BS')))

    # Equivalencia contable para el descuadre en USD
    monto_equivalente_principal = models.DecimalField(max_digits=15, decimal_places=2)
    tasa_cambio_momento = models.DecimalField(max_digits=15, decimal_places=2)

    observacion = models.TextField(blank=True, help_text="Ej: Pago de botellón de agua")

    def __str__(self):
        return f"Egreso #{self.id} - {self.monto_extraido} {self.moneda_extraida}"

class EgresoInventario(models.Model):
    """Cabecera para salida de productos sin venta (Donaciones o Consumo Interno)."""
    ESTADOS = (('BORRADOR', 'Borrador'), ('PROCESADO', 'Procesado'), ('ANULADO', 'Anulado'))

    concepto = models.ForeignKey(ConceptoEgreso, on_delete=models.RESTRICT)
    almacen = models.ForeignKey('Almacen', on_delete=models.RESTRICT)
    usuario = models.ForeignKey('Usuario', on_delete=models.RESTRICT)
    fecha = models.DateTimeField(default=timezone.now)
    estado = models.CharField(max_length=15, choices=ESTADOS, default='BORRADOR')

    total_costo_principal = models.DecimalField(max_digits=15, decimal_places=2, default=Decimal('0.00'))
    observacion = models.TextField(blank=True)

    class Meta:
        verbose_name = "Egreso de Inventario"
        verbose_name_plural = "Egresos de Inventario"

    def procesar_egreso(self):
        """Descuenta stock y bloquea el documento."""
        with transaction.atomic():
            if self.estado != 'BORRADOR':
                raise ValueError("Solo se pueden procesar egresos en estado BORRADOR.")

            for detalle in self.detalles.all():
                cant_base = detalle.cantidad * detalle.presentacion.factor_conversion

                inv, _ = InventarioAlmacen.objects.get_or_create(
                    producto=detalle.presentacion.producto,
                    almacen=self.almacen
                )

                if inv.stock_actual_unidades_base < cant_base:
                    raise ValueError(f"Stock insuficiente para egreso: {detalle.presentacion.producto.nombre}")

                inv.stock_actual_unidades_base -= cant_base
                inv.save()

            self.estado = 'PROCESADO'
            self.save()

class DetalleEgresoInventario(models.Model):
    egreso = models.ForeignKey(EgresoInventario, on_delete=models.CASCADE, related_name='detalles')
    presentacion = models.ForeignKey('PresentacionProducto', on_delete=models.RESTRICT)
    cantidad = models.DecimalField(max_digits=15, decimal_places=2)

    # Registramos el costo para saber cuánto dinero "salió" en mercancía
    costo_unitario_aplicado = models.DecimalField(max_digits=15, decimal_places=2)
    subtotal_costo = models.DecimalField(max_digits=15, decimal_places=2)
