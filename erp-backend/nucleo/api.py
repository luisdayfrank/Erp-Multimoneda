from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.permissions import IsAuthenticated
from django.db import transaction
from django.db.models import Sum, Count, Q, DecimalField
from django.utils import timezone
from django.db.models.functions import Coalesce
from datetime import timedelta
from .models import (
    PresentacionProducto, Venta, Compra, CuentaPorCobrar, 
    CuentaPorPagar, InventarioAlmacen, SesionCaja, Cliente,
    MetodoPago, PagoCuentaCobrar, ConfiguracionGlobal, DetalleVenta, DetalleCompra,
    Producto, Proveedor, PagoCuentaPagar, ConceptoEgreso, DetalleEgresoInventario
)
from .serializers import (
    PresentacionProductoSerializer, VentaSerializer, CompraSerializer, 
    SesionCajaSerializer, PagoCuentaCobrarSerializer, ClienteSerializer, 
    MetodoPagoSerializer, PagoCuentaPagarSerializer, ProveedorSerializer,
    ConceptoEgresoSerializer, EgresoCajaSerializer, EgresoInventarioSerializer,
    AbonoMasivoSerializer
)
from .permissions import IsCajeroOrSuperior, IsGerenteOrAdmin
from decimal import Decimal

class GestionCajaAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request):
        sesion = SesionCaja.objects.filter(usuario=request.user, estado='ABIERTA').first()
        if sesion:
            serializer = SesionCajaSerializer(sesion)
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response({"mensaje": "No hay caja abierta."}, status=status.HTTP_404_NOT_FOUND)

    def post(self, request):
        if SesionCaja.objects.filter(usuario=request.user, estado='ABIERTA').exists():
            return Response({"error": "Ya tienes un turno de caja abierto."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = SesionCajaSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(usuario=request.user, estado='ABIERTA')
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def put(self, request):
        sesion = SesionCaja.objects.filter(usuario=request.user, estado='ABIERTA').first()
        if not sesion:
            return Response({"error": "No tienes ninguna caja abierta para cerrar."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = SesionCajaSerializer(sesion, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save(estado='CERRADA', fecha_cierre=timezone.now())
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class CatalogoPosAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request):
        sesion = SesionCaja.objects.filter(usuario=request.user, estado='ABIERTA').first()

        if not sesion:
            return Response(
                {"mensaje": "No hay caja abierta válida para operar."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        hoy = timezone.localtime().date()
        fecha_apertura_dia = timezone.localtime(sesion.fecha_apertura).date()

        if fecha_apertura_dia < hoy:
            return Response(
                {"mensaje": "Caja de un día anterior. Cierre obligatorio."}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        print(f"📦 CATÁLOGO SOLICITADO POR: {request.user.username} (Caja OK)")

        presentaciones = PresentacionProducto.objects.all()
        serializer = PresentacionProductoSerializer(presentaciones, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProcesarVentaAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    @transaction.atomic
    def post(self, request):
        serializer = VentaSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                venta = serializer.save()
                venta.procesar_venta()

                return Response({
                    "mensaje": "Venta procesada exitosamente",
                    "venta_id": venta.id,
                    "cajero": request.user.username,
                    "total_cobrado": venta.total_principal
                }, status=status.HTTP_201_CREATED)

            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                return Response({"error": "Error interno al procesar la transacción."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ProcesarCompraAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    @transaction.atomic
    def post(self, request):
        serializer = CompraSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                compra = serializer.save()
                compra.procesar_compra()

                return Response({
                    "mensaje": "Compra registrada y stock actualizado exitosamente",
                    "compra_id": compra.id,
                    "registrado_por": request.user.username,
                    "total_pagar": compra.total_principal
                }, status=status.HTTP_201_CREATED)

            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                return Response({"error": "Error interno al procesar la compra."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class RegistrarAbonoMasivoAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    @transaction.atomic
    def post(self, request):
        serializer = AbonoMasivoSerializer(data=request.data, context={'request': request})
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        cliente_id = serializer.validated_data['cliente_id']
        pagos_data = serializer.validated_data['pagos']
        tasa_cambio = serializer.validated_data.get('tasa_cambio', Decimal('0.00'))
        guardar_saldo_favor = serializer.validated_data.get('guardar_saldo_favor', False)

        try:
            cliente = Cliente.objects.get(pk=cliente_id)
        except Cliente.DoesNotExist:
            return Response({"error": "Cliente no encontrado."}, status=status.HTTP_404_NOT_FOUND)

        total_abono_usd = Decimal('0.00')
        for pago in pagos_data:
            monto = Decimal(str(pago['monto_pagado']))
            metodo = MetodoPago.objects.get(pk=pago['metodo_id'])

            if metodo.moneda_referencia == 'SECUNDARIA' and tasa_cambio > 0:
                monto_usd = monto / tasa_cambio
            else:
                monto_usd = monto
            total_abono_usd += monto_usd

        facturas_pendientes = CuentaPorCobrar.objects.filter(
            cliente=cliente,
            estado__in=['PENDIENTE', 'VENCIDA']
        ).select_related('venta').order_by('venta__fecha')

        if not facturas_pendientes.exists() and total_abono_usd > 0:
            if not guardar_saldo_favor:
                return Response({
                    "error": "El cliente no tiene facturas pendientes. El monto excedería la deuda.",
                    "requiere_confirmacion_saldo": True,
                    "monto_sobrante": float(total_abono_usd)
                }, status=status.HTTP_400_BAD_REQUEST)
            else:
                cliente.saldo_a_favor += total_abono_usd
                cliente.save(update_fields=['saldo_a_favor'])
                return Response({
                    "mensaje": "Saldo a favor guardado exitosamente.",
                    "saldo_a_favor_total": float(cliente.saldo_a_favor),
                    "monto_guardado": float(total_abono_usd)
                }, status=status.HTTP_200_OK)

        abono_restante = total_abono_usd
        facturas_pagadas = []

        for cxc in facturas_pendientes:
            if abono_restante <= Decimal('0.00'):
                break

            saldo_antes = cxc.saldo_pendiente
            monto_aplicar = min(abono_restante, saldo_antes)

            PagoCuentaCobrar.objects.create(
                cuenta=cxc,
                usuario=request.user,
                monto_abono_principal=monto_aplicar,
                monto_entregado_secundaria=Decimal('0.00'),
                tasa_cambio_pago=tasa_cambio,
                referencia=f"Abono distribuido automáticamente"
            )

            cxc.saldo_pendiente -= monto_aplicar
            if cxc.saldo_pendiente <= Decimal('0.00'):
                cxc.saldo_pendiente = Decimal('0.00')
                cxc.estado = 'PAGADA'
            cxc.save()

            abono_restante -= monto_aplicar
            facturas_pagadas.append({
                "cxc_id": cxc.id,
                "venta_id": cxc.venta.id if cxc.venta else None,
                "monto_aplicado": float(monto_aplicar),
                "saldo_restante": float(cxc.saldo_pendiente),
                "estado": cxc.estado
            })

        saldo_sobrante = Decimal('0.00')
        if abono_restante > Decimal('0.00'):
            if guardar_saldo_favor:
                cliente.saldo_a_favor += abono_restante
                cliente.save(update_fields=['saldo_a_favor'])
                saldo_sobrante = abono_restante
            else:
                return Response({
                    "error": "El monto del abono supera la deuda total del cliente.",
                    "requiere_confirmacion_saldo": True,
                    "monto_sobrante": float(abono_restante),
                    "facturas_pagadas": facturas_pagadas
                }, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "mensaje": "Abono procesado exitosamente.",
            "total_abono": float(total_abono_usd),
            "facturas_afectadas": facturas_pagadas,
            "saldo_a_favor": float(cliente.saldo_a_favor),
            "saldo_sobrante_guardado": float(saldo_sobrante)
        }, status=status.HTTP_201_CREATED)


class RegistrarAbonoCxCAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    @transaction.atomic
    def post(self, request):
        serializer = PagoCuentaCobrarSerializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                pago = serializer.save()
                pago.procesar_pago()

                return Response({
                    "mensaje": "Abono registrado exitosamente",
                    "pago_id": pago.id,
                    "nuevo_saldo_pendiente": pago.cuenta.saldo_pendiente,
                    "estado_cuenta": pago.cuenta.estado
                }, status=status.HTTP_201_CREATED)

            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                return Response({"error": "Error interno del servidor."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class DashboardResumenAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def get(self, request):
        hoy = timezone.now().date()
        inicio_mes = hoy.replace(day=1)

        ventas_hoy = Venta.objects.filter(
            fecha__date=hoy, estado='PROCESADA'
        ).aggregate(
            total_usd=Sum('total_principal'),
            cantidad_facturas=Count('id')
        )

        ventas_mes = Venta.objects.filter(
            fecha__date__gte=inicio_mes, estado='PROCESADA'
        ).aggregate(total_usd=Sum('total_principal'))

        cxc_pendientes = CuentaPorCobrar.objects.filter(
            estado__in=['PENDIENTE', 'VENCIDA']
        ).aggregate(
            total_deuda=Sum('saldo_pendiente'),
            clientes_deudores=Count('cliente', distinct=True)
        )

        cxp_pendientes = CuentaPorPagar.objects.filter(
            estado__in=['PENDIENTE', 'VENCIDA']
        ).aggregate(total_deuda=Sum('saldo_pendiente'))

        inventario_critico = InventarioAlmacen.objects.filter(
            stock_actual_unidades_base__lte=10
        ).select_related('producto', 'almacen').order_by('stock_actual_unidades_base')[:5]

        lista_alertas_stock = [
            {
                "producto": item.producto.nombre,
                "almacen": item.almacen.nombre,
                "stock_actual": item.stock_actual_unidades_base,
                "unidad": item.producto.unidad_medida.sigla
            }
            for item in inventario_critico
        ]

        return Response({
            "ventas": {
                "hoy_total": ventas_hoy['total_usd'] or 0.00,
                "hoy_cantidad": ventas_hoy['cantidad_facturas'] or 0,
                "mes_total": ventas_mes['total_usd'] or 0.00,
            },
            "finanzas": {
                "por_cobrar_total": cxc_pendientes['total_deuda'] or 0.00,
                "clientes_con_deuda": cxc_pendientes['clientes_deudores'] or 0,
                "por_pagar_total": cxp_pendientes['total_deuda'] or 0.00,
            },
            "alertas": {
                "inventario_bajo": lista_alertas_stock
            }
        }, status=status.HTTP_200_OK)


class DatosInicialesPOSAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request):
        clientes = Cliente.objects.all().order_by('nombre')
        metodos = MetodoPago.objects.filter(activo=True)

        return Response({
            "clientes": ClienteSerializer(clientes, many=True).data,
            "metodos_pago": MetodoPagoSerializer(metodos, many=True).data
        }, status=status.HTTP_200_OK)


class ClienteListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request):
        clientes = Cliente.objects.annotate(
            deuda_total=Coalesce(
                Sum('cuentaporcobrar__saldo_pendiente', filter=Q(cuentaporcobrar__estado__in=['PENDIENTE', 'VENCIDA'])),
                Decimal('0.00'),
                output_field=DecimalField()
            )
        ).order_by('nombre')

        data = []
        for c in clientes:
            data.append({
                "id": c.id,
                "nombre": c.nombre,
                "documento": c.documento,
                "telefono": c.telefono,
                "limite_credito": float(c.limite_credito),
                "deuda_total": float(c.deuda_total),
                "saldo_a_favor": float(c.saldo_a_favor),
                "deuda_inicial": float(c.deuda_inicial)
            })
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request):
        serializer = ClienteSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class ClienteDetalleHistorialAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request, pk):
        try:
            cliente = Cliente.objects.get(pk=pk)
            ventas = Venta.objects.filter(cliente=cliente).order_by('-fecha')
            pagos = PagoCuentaCobrar.objects.filter(cuenta__cliente=cliente).order_by('-fecha')

            cxc_pendientes = CuentaPorCobrar.objects.filter(cliente=cliente, estado__in=['PENDIENTE', 'VENCIDA'])

            config = ConfiguracionGlobal.objects.first()
            tasa_actual = float(config.tasa_cambio_actual) if config else 1.00

            data_cliente = ClienteSerializer(cliente).data
            deuda_total = cxc_pendientes.aggregate(total=Sum('saldo_pendiente'))['total'] or 0.00

            # >>> NUEVO: Incluimos deuda_inicial en la respuesta <<<
            return Response({
                "cliente": data_cliente,
                "deuda_total": float(deuda_total),
                "limite_credito": float(cliente.limite_credito),
                "saldo_a_favor": float(cliente.saldo_a_favor),
                "deuda_inicial": float(cliente.deuda_inicial),
                "tasa_actual": tasa_actual,
                "facturas_pendientes": [{
                    "cxc_id": c.id,
                    "venta_id": c.venta.id if c.venta else None,
                    "tipo_origen": "VENTA" if c.venta else "DEUDA_INICIAL",
                    "saldo_pendiente": float(c.saldo_pendiente),
                    "fecha": c.venta.fecha if c.venta else c.fecha_vencimiento,
                    "monto_total": float(c.monto_total),
                    "tipo_venta": c.venta.tipo if c.venta else "INICIAL"
                } for c in cxc_pendientes],
                "ventas": [
                    {
                        "id": v.id, 
                        "fecha": v.fecha, 
                        "tipo": v.tipo,
                        "monto": float(v.total_principal), 
                        "estado": v.estado
                    } for v in ventas
                ],
                "pagos": [
                    {
                        "id": p.id, 
                        "fecha": p.fecha, 
                        "monto": float(p.monto_abono_principal), 
                        "referencia": p.referencia, 
                        "factura_id": p.cuenta.venta.id if p.cuenta.venta else None
                    } for p in pagos
                ]
            })
        except Cliente.DoesNotExist:
            return Response({"error": "Cliente no encontrado"}, status=404)

class ClienteUpdateAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def put(self, request, pk):
        try:
            cliente = Cliente.objects.get(pk=pk)
            serializer = ClienteSerializer(cliente, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except Cliente.DoesNotExist:
            return Response({"error": "Cliente no encontrado"}, status=404)

class ProductoInventarioAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def get(self, request):
        productos = Producto.objects.all().select_related('categoria', 'unidad_medida')
        data = []
        for p in productos:
            stock_total = InventarioAlmacen.objects.filter(producto=p).aggregate(total=Sum('stock_actual_unidades_base'))['total'] or 0.00
            data.append({
                "id": p.id,
                "codigo_base": p.codigo_base,
                "nombre": p.nombre,
                "categoria": p.categoria.nombre if p.categoria else "S/C",
                "costo": float(p.costo_base_moneda_principal),
                "stock_total": float(stock_total),
                "stock_inicial": float(p.stock_inicial),
                "unidad": p.unidad_medida.sigla if p.unidad_medida else "und"
            })
        return Response(data, status=status.HTTP_200_OK)

class ProductoDetalleHistorialAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def get(self, request, pk):
        try:
            producto = Producto.objects.get(pk=pk)

            stock_almacenes = InventarioAlmacen.objects.filter(producto=producto).select_related('almacen')
            data_stock = [{"almacen": s.almacen.nombre, "cantidad": float(s.stock_actual_unidades_base)} for s in stock_almacenes]

            presentaciones = PresentacionProducto.objects.filter(producto=producto).select_related('unidad_medida')
            data_pres = [{
                "nombre": p.unidad_medida.nombre if p.unidad_medida else "Base", 
                "factor": float(p.factor_conversion), 
                "precio_usd": float(p.precio_venta_principal),
                "costo": float(p.costo_presentacion),
                "margen": float(p.margen_ganancia_porcentaje)
            } for p in presentaciones]

            # Historial de Movimientos
            ventas = DetalleVenta.objects.filter(
                presentacion__producto=producto, 
                venta__estado='PROCESADA'
            ).select_related('venta').order_by('-venta__fecha')[:30]

            compras = DetalleCompra.objects.filter(
                presentacion__producto=producto, 
                compra__estado='PROCESADA'
            ).select_related('compra').order_by('-compra__fecha')[:30]

            egresos = DetalleEgresoInventario.objects.filter(
                presentacion__producto=producto, 
                egreso__estado='PROCESADO'
            ).select_related('egreso').order_by('-egreso__fecha')[:30]

            movimientos = []

            # >>> NUEVO: Stock inicial como primer movimiento <<<
            if producto.stock_inicial > Decimal('0.00'):
                almacen_inicial = producto.almacen_inicial.nombre if producto.almacen_inicial else "Almacén por defecto"
                movimientos.append({
                    "fecha": producto.fecha_creacion,
                    "tipo": "ENTRADA",
                    "motivo": f"Stock Inicial - {almacen_inicial}",
                    "cantidad": float(producto.stock_inicial)
                })

            for v in ventas:
                cantidad_base = v.cantidad_presentacion * v.presentacion.factor_conversion
                movimientos.append({
                    "fecha": v.venta.fecha,
                    "tipo": "SALIDA",
                    "motivo": f"Venta #{v.venta.id}",
                    "cantidad": float(cantidad_base)
                })

            for c in compras:
                cantidad_base = c.cantidad_presentacion * c.presentacion.factor_conversion
                movimientos.append({
                    "fecha": c.compra.fecha,
                    "tipo": "ENTRADA",
                    "motivo": f"Compra #{c.compra.id} ({c.compra.proveedor.nombre})",
                    "cantidad": float(cantidad_base)
                })

            for e in egresos:
                cantidad_base = e.cantidad * e.presentacion.factor_conversion
                movimientos.append({
                    "fecha": e.egreso.fecha,
                    "tipo": "SALIDA",
                    "motivo": f"Egreso #{e.egreso.id} ({e.egreso.concepto.nombre})",
                    "cantidad": float(cantidad_base)
                })

            movimientos.sort(key=lambda x: x['fecha'], reverse=True)

            return Response({
                "producto": {
                    "nombre": producto.nombre,
                    "codigo": producto.codigo_base,
                    "unidad": producto.unidad_medida.sigla if producto.unidad_medida else "",
                    "stock_inicial": float(producto.stock_inicial)
                },
                "stock_por_almacen": data_stock,
                "presentaciones": data_pres,
                "movimientos": movimientos
            }, status=status.HTTP_200_OK)

        except Producto.DoesNotExist:
            return Response({"error": "Producto no encontrado"}, status=status.HTTP_404_NOT_FOUND)

class ProveedorListCreateAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def get(self, request):
        proveedores = Proveedor.objects.all().order_by('nombre')
        serializer = ProveedorSerializer(proveedores, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        serializer = ProveedorSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class ProveedorUpdateAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def put(self, request, pk):
        try:
            proveedor = Proveedor.objects.get(pk=pk)
            serializer = ProveedorSerializer(proveedor, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except Proveedor.DoesNotExist:
            return Response({"error": "Proveedor no encontrado"}, status=status.HTTP_404_NOT_FOUND)

class ProveedorDetalleHistorialAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    def get(self, request, pk):
        try:
            proveedor = Proveedor.objects.get(pk=pk)
            compras = Compra.objects.filter(proveedor=proveedor).order_by('-fecha')
            pagos = PagoCuentaPagar.objects.filter(cuenta__proveedor=proveedor).order_by('-fecha')
            cxp_pendientes = CuentaPorPagar.objects.filter(proveedor=proveedor, estado__in=['PENDIENTE', 'VENCIDA'])

            config = ConfiguracionGlobal.objects.first()
            tasa_actual = float(config.tasa_cambio_actual) if config else 1.00

            deuda_total = cxp_pendientes.aggregate(total=Sum('saldo_pendiente'))['total'] or 0.00

            return Response({
                "proveedor": ProveedorSerializer(proveedor).data,
                "deuda_total": float(deuda_total),
                "limite_credito": float(proveedor.limite_credito),
                "tasa_actual": tasa_actual,
                "facturas_pendientes": [{
                    "cxp_id": c.id,
                    "compra_id": c.compra.id,
                    "saldo_pendiente": float(c.saldo_pendiente)
                } for c in cxp_pendientes],
                "compras": [{"id": c.id, "fecha": c.fecha, "tipo": c.tipo, "monto": float(c.total_principal), "estado": c.estado} for c in compras],
                "pagos": [{"id": p.id, "fecha": p.fecha, "monto": float(p.monto_abono_principal), "referencia": p.referencia, "factura_id": p.cuenta.compra.id} for p in pagos]
            })
        except Proveedor.DoesNotExist:
            return Response({"error": "Proveedor no encontrado"}, status=status.HTTP_404_NOT_FOUND)

class RegistrarAbonoCxPAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    @transaction.atomic
    def post(self, request):
        serializer = PagoCuentaPagarSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            try:
                pago = serializer.save()
                pago.procesar_pago()
                return Response({"mensaje": "Abono registrado exitosamente"}, status=status.HTTP_201_CREATED)
            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class ConceptoEgresoListAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request):
        conceptos = ConceptoEgreso.objects.filter(activo=True)
        serializer = ConceptoEgresoSerializer(conceptos, many=True)
        return Response(serializer.data)

class RegistrarEgresoCajaAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    @transaction.atomic
    def post(self, request):
        serializer = EgresoCajaSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response({"mensaje": "Egreso de efectivo registrado correctamente."}, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class RegistrarEgresoInventarioAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    @transaction.atomic
    def post(self, request):
        serializer = EgresoInventarioSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            try:
                egreso = serializer.save()
                egreso.procesar_egreso()
                return Response({
                    "mensaje": "Egreso de inventario procesado con éxito.",
                    "egreso_id": egreso.id
                }, status=status.HTTP_201_CREATED)
            except ValueError as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class ActualizarCostosProductosAPIView(APIView):
    permission_classes = [IsAuthenticated, IsGerenteOrAdmin]

    @transaction.atomic
    def post(self, request):
        cambios = request.data.get('cambios', [])
        for cambio in cambios:
            presentacion_id = cambio.get('presentacion_id')
            nuevo_costo_pres = Decimal(str(cambio.get('nuevo_costo')))

            try:
                presentacion = PresentacionProducto.objects.select_related('producto').get(pk=presentacion_id)
                producto = presentacion.producto

                if presentacion.factor_conversion > 0:
                    producto.costo_base_moneda_principal = nuevo_costo_pres / presentacion.factor_conversion
                    producto.save(update_fields=['costo_base_moneda_principal'])
            except PresentacionProducto.DoesNotExist:
                continue

        return Response({"mensaje": "Costos maestros actualizados correctamente."}, status=status.HTTP_200_OK)

class DetalleVentaFacturaAPIView(APIView):
    permission_classes = [IsAuthenticated, IsCajeroOrSuperior]

    def get(self, request, pk):
        try:
            venta = Venta.objects.get(pk=pk)
            detalles = venta.detalles.all().select_related('presentacion__producto', 'presentacion__unidad_medida')
            pagos = venta.pagos.all().select_related('metodo')

            productos_data = []
            for d in detalles:
                productos_data.append({
                    "producto": d.presentacion.producto.nombre,
                    "presentacion": d.presentacion.unidad_medida.nombre if d.presentacion.unidad_medida else "Unidad",
                    "cantidad": float(d.cantidad_presentacion),
                    "precio_unitario": float(d.precio_unitario_aplicado),
                    "subtotal": float(d.subtotal)
                })

            pagos_data = []
            for p in pagos:
                pagos_data.append({
                    "metodo": p.metodo.nombre,
                    "monto_pagado": float(p.monto_pagado),
                    "monto_usd": float(p.monto_equivalente_principal),
                    "referencia": p.referencia or "S/R"
                })

            return Response({
                "id": venta.id,
                "fecha": venta.fecha,
                "tipo": venta.tipo,
                "estado": venta.estado,
                "subtotal_principal": float(venta.subtotal_principal),
                "total_impuestos_principal": float(venta.total_impuestos_principal),
                "total_principal": float(venta.total_principal),
                "total_secundaria": float(venta.total_secundaria),
                "tasa_cambio": float(venta.tasa_cambio_historica),
                "productos": productos_data,
                "pagos": pagos_data
            }, status=status.HTTP_200_OK)
        except Venta.DoesNotExist:
            return Response({"error": "Factura no encontrada"}, status=status.HTTP_404_NOT_FOUND)
