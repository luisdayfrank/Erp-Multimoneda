# ==============================================================================
# CENTRO DE INFORMES — Bloque INVENTARIO (Fase 2)
# ==============================================================================
"""
5 informes de inventario:

1. Valorización          /informes/inventario/valorizacion/
2. Kardex / Movimientos  /informes/inventario/kardex/?producto_id=
3. Stock bajo mínimo     /informes/inventario/stock-bajo/?minimo=10
4. Sin movimiento        /informes/inventario/sin-movimiento/?dias=90
5. Rotación por categoría /informes/inventario/rotacion/?dias=90

Todos siguen el contrato estándar de `InformeBaseAPIView` (columnas/resultados/
resumen) y soportan ?export=xlsx.
"""

from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Max, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from ..models import (
    AjusteInventario,
    Compra,
    DetalleAjusteInventario,
    DetalleCompra,
    DetalleEgresoInventario,
    DetalleVenta,
    EgresoInventario,
    InventarioAlmacen,
    PresentacionProducto,
    Producto,
    RutaMercadoDetalle,
    Venta,
)
from .base import InformeBaseAPIView, parse_fecha, rango_fechas

CERO = Decimal('0.00')


# ==============================================================================
# 1. VALORIZACIÓN DE INVENTARIO
# ==============================================================================
class InformeValorizacionInventarioAPIView(InformeBaseAPIView):
    """
    ¿Cuánto capital tengo y en qué productos?
    ?incluir_sin_stock=1  -> incluye productos en stock 0
    ?categoria_id=        -> filtra por categoría
    """

    def get(self, request):
        try:
            desde_dt, hasta_dt = rango_fechas(request)  # sin uso: valorización es a hoy
        except ValueError:
            return self.respuesta_invalida("Formato de fecha inválido (usa YYYY-MM-DD)")

        incluir_sin_stock = str(request.query_params.get('incluir_sin_stock', '')).lower() in ('1', 'true', 'yes')
        categoria_id = request.query_params.get('categoria_id')

        productos = Producto.objects.select_related('categoria', 'unidad_medida').order_by('codigo_base')
        if categoria_id:
            productos = productos.filter(categoria_id=categoria_id)

        # Stock actual por producto (1 query agrupada)
        stock_map = {
            fila['producto_id']: fila['stock'] or CERO
            for fila in InventarioAlmacen.objects.values('producto_id').annotate(
                stock=Sum('stock_actual_unidades_base')
            )
        }

        # Precio de venta por unidad base = MIN(precio_presentacion / factor)
        precios_base = {}
        for pres in PresentacionProducto.objects.values(
            'producto_id', 'factor_conversion', 'precio_venta_principal'
        ):
            factor = pres['factor_conversion'] or Decimal('1.0000')
            if factor <= 0:
                continue
            precio_base = pres['precio_venta_principal'] / factor
            actual = precios_base.get(pres['producto_id'])
            if actual is None or precio_base < actual:
                precios_base[pres['producto_id']] = precio_base

        resultados = []
        total_valor_costo = CERO
        total_valor_venta = CERO

        for p in productos:
            stock = stock_map.get(p.id, CERO)
            if not incluir_sin_stock and stock <= 0:
                continue

            valor_costo = stock * (p.costo_base_moneda_principal or CERO)
            precio_venta_base = precios_base.get(p.id)
            valor_venta = stock * precio_venta_base if precio_venta_base is not None else None

            total_valor_costo += valor_costo
            if valor_venta is not None:
                total_valor_venta += valor_venta

            resultados.append({
                'codigo': p.codigo_base,
                'nombre': p.nombre,
                'categoria': p.categoria.nombre if p.categoria else 'S/C',
                'stock': float(stock),
                'unidad': p.unidad_medida.sigla if p.unidad_medida else 'und',
                'costo_base': float(p.costo_base_moneda_principal or CERO),
                'valor_costo': float(valor_costo),
                'precio_venta_base': float(precio_venta_base) if precio_venta_base is not None else None,
                'valor_venta': float(valor_venta) if valor_venta is not None else None,
            })

        resumen = {
            'Productos': len(resultados),
            'Valor a costo (USD)': float(total_valor_costo),
            'Valor a precio de venta (USD)': float(total_valor_venta),
        }

        columnas = [
                {'campo': 'codigo', 'titulo': 'Código'},
                {'campo': 'nombre', 'titulo': 'Producto'},
                {'campo': 'categoria', 'titulo': 'Categoría'},
                {'campo': 'stock', 'titulo': 'Stock', 'formato': 'numero'},
                {'campo': 'unidad', 'titulo': 'Unidad'},
                {'campo': 'costo_base', 'titulo': 'Costo Base', 'formato': 'moneda'},
                {'campo': 'valor_costo', 'titulo': 'Valor a Costo', 'formato': 'moneda'},
                {'campo': 'precio_venta_base', 'titulo': 'Precio Venta/Und', 'formato': 'moneda'},
                {'campo': 'valor_venta', 'titulo': 'Valor a Venta', 'formato': 'moneda'},
            ]
        excel = self.exportar_excel(
            request, 'Valorización de Inventario', columnas, resultados,
            'valorizacion_inventario.xlsx', resumen,
        )
        if excel:
            return excel

        return Response({
            'titulo': 'Valorización de Inventario',
            'columnas': columnas,
            'resultados': resultados,
            'resumen': resumen,
        }, status=status.HTTP_200_OK)


# ==============================================================================
# 2. KARDEX / MOVIMIENTOS DE UN PRODUCTO
# ==============================================================================
class InformeKardexAPIView(InformeBaseAPIView):
    """
    Historial completo de un producto: compras, ventas, egresos, ajustes y rutas.
    ?producto_id=REQUERIDO  ?desde=  ?hasta=
    Incluye saldo corrido (saldo inicial antes del rango + movimientos del rango).
    """

    def get(self, request):
        producto_id = request.query_params.get('producto_id')
        if not producto_id:
            return self.respuesta_invalida("Debes enviar producto_id")

        try:
            producto = Producto.objects.select_related('unidad_medida').get(pk=producto_id)
        except (Producto.DoesNotExist, ValueError):
            return Response({"error": "Producto no encontrado"}, status=status.HTTP_404_NOT_FOUND)

        try:
            desde_dt, hasta_dt = rango_fechas(request)
        except ValueError:
            return self.respuesta_invalida("Formato de fecha inválido (usa YYYY-MM-DD)")

        unidad = producto.unidad_medida.sigla if producto.unidad_medida else 'und'

        # ---- Recolectar movimientos (mismas fuentes que el kardex de la ficha) ----
        def en_rango(fecha):
            if desde_dt and fecha < desde_dt:
                return False
            if hasta_dt and fecha >= hasta_dt:
                return False
            return True

        movimientos = []  # (fecha, tipo, motivo, documento, cantidad_base)

        # Stock inicial (siempre visible como primer movimiento)
        if producto.stock_inicial > 0:
            movimientos.append((
                producto.fecha_creacion, 'ENTRADA',
                f"Stock Inicial - {producto.almacen_inicial.nombre if producto.almacen_inicial else 'Almacén por defecto'}",
                '—', producto.stock_inicial,
            ))

        compras = DetalleCompra.objects.filter(
            presentacion__producto=producto, compra__estado='PROCESADA'
        ).select_related('compra', 'compra__proveedor', 'presentacion')
        for c in compras:
            cantidad = c.cantidad_presentacion * c.presentacion.factor_conversion
            movimientos.append((
                c.compra.fecha, 'ENTRADA',
                f"Compra #{c.compra.id} ({c.compra.proveedor.nombre})",
                f"C-{c.compra.id}", cantidad,
            ))

        ventas = DetalleVenta.objects.filter(
            presentacion__producto=producto, venta__estado='PROCESADA'
        ).select_related('venta', 'presentacion')
        for v in ventas:
            cantidad = v.cantidad_presentacion * v.presentacion.factor_conversion
            movimientos.append((
                v.venta.fecha, 'SALIDA', f"Venta #{v.venta.id}", f"V-{v.venta.id}", cantidad,
            ))

        egresos = DetalleEgresoInventario.objects.filter(
            presentacion__producto=producto, egreso__estado='PROCESADO'
        ).select_related('egreso', 'egreso__concepto', 'presentacion')
        for e in egresos:
            cantidad = e.cantidad * e.presentacion.factor_conversion
            movimientos.append((
                e.egreso.fecha, 'SALIDA',
                f"Egreso: {e.egreso.concepto.nombre}", f"E-{e.egreso.id}", cantidad,
            ))

        ajustes = DetalleAjusteInventario.objects.filter(
            producto=producto, ajuste__estado='PROCESADO'
        ).select_related('ajuste')
        for a in ajustes:
            cantidad = abs(a.cantidad_ajustada)
            tipo = 'ENTRADA' if a.tipo_ajuste == 'ENTRADA' else 'SALIDA'
            movimientos.append((
                a.ajuste.fecha, tipo,
                f"Ajuste por toma física", f"A-{a.ajuste.id}", cantidad,
            ))

        rutas = RutaMercadoDetalle.objects.filter(
            presentacion__producto=producto, ruta__estado='CERRADA'
        ).select_related('ruta', 'presentacion')
        for rm in rutas:
            cantidad = rm.cantidad_vendida * rm.presentacion.factor_conversion
            if cantidad > 0:
                movimientos.append((
                    rm.ruta.fecha, 'SALIDA', f"Ruta Mercado #{rm.ruta.id}", f"R-{rm.ruta.id}", cantidad,
                ))

        # ---- Saldo inicial (todo lo anterior al rango) ----
        saldo_inicial = CERO
        en_rango_lista = []
        for fecha, tipo, motivo, documento, cantidad in movimientos:
            if desde_dt and fecha < desde_dt:
                saldo_inicial += cantidad if tipo == 'ENTRADA' else -cantidad
            elif en_rango(fecha):
                en_rango_lista.append((fecha, tipo, motivo, documento, cantidad))
            # los posteriores a hasta_dt se ignoran (informe histórico)

        en_rango_lista.sort(key=lambda x: x[0])

        resultados = []
        saldo = saldo_inicial
        total_entradas = CERO
        total_salidas = CERO
        for fecha, tipo, motivo, documento, cantidad in en_rango_lista:
            saldo += cantidad if tipo == 'ENTRADA' else -cantidad
            if tipo == 'ENTRADA':
                total_entradas += cantidad
            else:
                total_salidas += cantidad
            resultados.append({
                'fecha': timezone.localtime(fecha).strftime('%Y-%m-%d %H:%M'),
                'tipo': tipo,
                'documento': documento,
                'motivo': motivo,
                'cantidad': float(cantidad),
                'saldo': float(saldo),
            })

        resumen = {
            'Producto': f"{producto.codigo_base} - {producto.nombre}",
            'Unidad': unidad,
            'Saldo inicial': float(saldo_inicial),
            'Total entradas': float(total_entradas),
            'Total salidas': float(total_salidas),
            'Saldo final': float(saldo),
        }

        columnas = [
                {'campo': 'fecha', 'titulo': 'Fecha'},
                {'campo': 'tipo', 'titulo': 'Tipo'},
                {'campo': 'documento', 'titulo': 'Documento'},
                {'campo': 'motivo', 'titulo': 'Motivo'},
                {'campo': 'cantidad', 'titulo': f'Cantidad ({unidad})', 'formato': 'numero'},
                {'campo': 'saldo', 'titulo': f'Saldo ({unidad})', 'formato': 'numero'},
            ]
        excel = self.exportar_excel(
            request, f"Kardex - {producto.nombre}", columnas, resultados,
            f"kardex_{producto.codigo_base}.xlsx", resumen,
        )
        if excel:
            return excel

        return Response({
            'titulo': f"Kardex - {producto.nombre}",
            'columnas': columnas,
            'resultados': resultados,
            'resumen': resumen,
        }, status=status.HTTP_200_OK)


# ==============================================================================
# 3. STOCK BAJO MÍNIMO
# ==============================================================================
class InformeStockBajoAPIView(InformeBaseAPIView):
    """Productos por debajo de un umbral configurable. ?minimo=10 (default 10)."""

    def get(self, request):
        try:
            minimo = Decimal(str(request.query_params.get('minimo', '10')))
        except Exception:
            return self.respuesta_invalida("Parámetro 'minimo' inválido")

        filas = (
            InventarioAlmacen.objects.values(
                'producto_id', 'producto__codigo_base', 'producto__nombre',
                'producto__categoria__nombre', 'producto__unidad_medida__sigla',
                'producto__costo_base_moneda_principal',
            )
            .annotate(stock=Sum('stock_actual_unidades_base'))
            .order_by('stock')
        )

        resultados = []
        valor_total = CERO
        for fila in filas:
            stock = fila['stock'] or CERO
            if stock >= minimo:
                continue
            valor = stock * (fila['producto__costo_base_moneda_principal'] or CERO)
            valor_total += valor
            resultados.append({
                'codigo': fila['producto__codigo_base'],
                'nombre': fila['producto__nombre'],
                'categoria': fila['producto__categoria__nombre'] or 'S/C',
                'stock': float(stock),
                'unidad': fila['producto__unidad_medida__sigla'] or 'und',
                'valor_stock': float(valor),
            })

        resumen = {
            f'Productos bajo {float(minimo)}': len(resultados),
            'Valor en riesgo (USD)': float(valor_total),
        }

        columnas = [
                {'campo': 'codigo', 'titulo': 'Código'},
                {'campo': 'nombre', 'titulo': 'Producto'},
                {'campo': 'categoria', 'titulo': 'Categoría'},
                {'campo': 'stock', 'titulo': 'Stock', 'formato': 'numero'},
                {'campo': 'unidad', 'titulo': 'Unidad'},
                {'campo': 'valor_stock', 'titulo': 'Valor Stock', 'formato': 'moneda'},
            ]
        excel = self.exportar_excel(
            request, 'Productos con Stock Bajo Mínimo', columnas, resultados,
            'stock_bajo_minimo.xlsx', resumen,
        )
        if excel:
            return excel

        return Response({
            'titulo': 'Productos con Stock Bajo Mínimo',
            'columnas': columnas,
            'resultados': resultados,
            'resumen': resumen,
        }, status=status.HTTP_200_OK)


# ==============================================================================
# 4. PRODUCTOS SIN MOVIMIENTO (capital muerto)
# ==============================================================================
class InformeSinMovimientoAPIView(InformeBaseAPIView):
    """Productos con stock > 0 y sin movimientos en X días. ?dias=90 (default 90)."""

    def get(self, request):
        try:
            dias = int(request.query_params.get('dias', '90'))
        except ValueError:
            return self.respuesta_invalida("Parámetro 'dias' inválido")
        if dias <= 0:
            return self.respuesta_invalida("Parámetro 'dias' debe ser mayor a 0")

        hoy = timezone.localdate()
        desde_dt = timezone.make_aware(
            datetime.combine(hoy - timedelta(days=dias), time.min)
        )

        # Productos con ALGÚN movimiento en la ventana (5 fuentes).
        # OJO: DetalleAjusteInventario referencia el producto directo (producto_id),
        # las demás fuentes vía presentacion__producto_id.
        con_movimiento = set()
        for qs, campo_producto, filtro_fecha in (
            (DetalleVenta.objects.filter(venta__estado='PROCESADA'), 'presentacion__producto_id', 'venta__fecha'),
            (DetalleCompra.objects.filter(compra__estado='PROCESADA'), 'presentacion__producto_id', 'compra__fecha'),
            (DetalleEgresoInventario.objects.filter(egreso__estado='PROCESADO'), 'presentacion__producto_id', 'egreso__fecha'),
            (DetalleAjusteInventario.objects.filter(ajuste__estado='PROCESADO'), 'producto_id', 'ajuste__fecha'),
            (RutaMercadoDetalle.objects.filter(ruta__estado='CERRADA'), 'presentacion__producto_id', 'ruta__fecha'),
        ):
            ids = qs.filter(**{f'{filtro_fecha}__gte': desde_dt}).values_list(
                campo_producto, flat=True
            )
            con_movimiento.update(i for i in ids if i)

        # Último movimiento histórico por producto (para informar la fecha)
        ultimas = {}
        for qs, campo_producto, filtro_fecha in (
            (DetalleVenta.objects.filter(venta__estado='PROCESADA'), 'presentacion__producto_id', 'venta__fecha'),
            (DetalleCompra.objects.filter(compra__estado='PROCESADA'), 'presentacion__producto_id', 'compra__fecha'),
            (DetalleEgresoInventario.objects.filter(egreso__estado='PROCESADO'), 'presentacion__producto_id', 'egreso__fecha'),
            (DetalleAjusteInventario.objects.filter(ajuste__estado='PROCESADO'), 'producto_id', 'ajuste__fecha'),
            (RutaMercadoDetalle.objects.filter(ruta__estado='CERRADA'), 'presentacion__producto_id', 'ruta__fecha'),
        ):
            for fila in qs.values(campo_producto).annotate(ultima=Max(filtro_fecha)):
                pid = fila[campo_producto]
                if not pid or not fila['ultima']:
                    continue
                if pid not in ultimas or fila['ultima'] > ultimas[pid]:
                    ultimas[pid] = fila['ultima']

        stock_map = {
            fila['producto_id']: fila['stock'] or CERO
            for fila in InventarioAlmacen.objects.values('producto_id').annotate(
                stock=Sum('stock_actual_unidades_base')
            )
        }

        productos = Producto.objects.select_related('categoria', 'unidad_medida').order_by('codigo_base')
        resultados = []
        valor_muerto = CERO
        for p in productos:
            stock = stock_map.get(p.id, CERO)
            if stock <= 0 or p.id in con_movimiento:
                continue
            ultima = ultimas.get(p.id)
            dias_sin_mov = (hoy - ultima.date()).days if ultima else None
            valor = stock * (p.costo_base_moneda_principal or CERO)
            valor_muerto += valor
            resultados.append({
                'codigo': p.codigo_base,
                'nombre': p.nombre,
                'categoria': p.categoria.nombre if p.categoria else 'S/C',
                'stock': float(stock),
                'unidad': p.unidad_medida.sigla if p.unidad_medida else 'und',
                'valor_stock': float(valor),
                'ultima_fecha': ultima.strftime('%Y-%m-%d') if ultima else 'Nunca',
                'dias_sin_movimiento': dias_sin_mov if dias_sin_mov is not None else -1,
            })

        resumen = {
            f'Productos sin movimiento ({dias} días)': len(resultados),
            'Capital muerto (USD)': float(valor_muerto),
        }

        columnas = [
                {'campo': 'codigo', 'titulo': 'Código'},
                {'campo': 'nombre', 'titulo': 'Producto'},
                {'campo': 'categoria', 'titulo': 'Categoría'},
                {'campo': 'stock', 'titulo': 'Stock', 'formato': 'numero'},
                {'campo': 'unidad', 'titulo': 'Unidad'},
                {'campo': 'valor_stock', 'titulo': 'Valor Stock', 'formato': 'moneda'},
                {'campo': 'ultima_fecha', 'titulo': 'Último Movimiento'},
                {'campo': 'dias_sin_movimiento', 'titulo': 'Días sin Mov.', 'formato': 'entero'},
            ]
        excel = self.exportar_excel(
            request, f'Productos sin Movimiento (últimos {dias} días)', columnas, resultados,
            'productos_sin_movimiento.xlsx', resumen,
        )
        if excel:
            return excel

        return Response({
            'titulo': f'Productos sin Movimiento (últimos {dias} días)',
            'columnas': columnas,
            'resultados': resultados,
            'resumen': resumen,
        }, status=status.HTTP_200_OK)


# ==============================================================================
# 5. ROTACIÓN POR CATEGORÍA
# ==============================================================================
class InformeRotacionCategoriaAPIView(InformeBaseAPIView):
    """
    Índice de rotación por categoría: unidades vendidas / stock actual.
    ?dias=90 (default 90).
    Nota: se usa stock actual como denominador (no hay histórico de stock promedio).
    """

    def get(self, request):
        try:
            dias = int(request.query_params.get('dias', '90'))
        except ValueError:
            return self.respuesta_invalida("Parámetro 'dias' inválido")
        if dias <= 0:
            return self.respuesta_invalida("Parámetro 'dias' debe ser mayor a 0")

        hoy = timezone.localdate()
        desde_dt = timezone.make_aware(
            datetime.combine(hoy - timedelta(days=dias), time.min)
        )

        # Unidades base vendidas por categoría (ventas POS del período).
        # Se itera por fila para convertir cantidad_presentacion -> unidad base.
        vendido_map = {}
        for fila in DetalleVenta.objects.filter(
            venta__estado='PROCESADA', venta__fecha__gte=desde_dt
        ).select_related('presentacion'):
            cat_id = fila.presentacion.producto.categoria_id
            cantidad_base = fila.cantidad_presentacion * fila.presentacion.factor_conversion
            if cat_id not in vendido_map:
                vendido_map[cat_id] = {'nombre': '', 'unidades': CERO, 'valor': CERO}
            vendido_map[cat_id]['unidades'] += cantidad_base

        # Nombres de categoría + stock actual + valor por categoría
        stock_map = {}
        valor_map = {}
        for fila in InventarioAlmacen.objects.values(
            'producto__categoria_id', 'producto__categoria__nombre',
            'producto__costo_base_moneda_principal',
        ).annotate(stock=Sum('stock_actual_unidades_base')):
            cat_id = fila['producto__categoria_id']
            stock = fila['stock'] or CERO
            if cat_id not in stock_map:
                stock_map[cat_id] = {'nombre': fila['producto__categoria__nombre'] or 'S/C', 'stock': CERO}
            stock_map[cat_id]['stock'] += stock
            valor_map[cat_id] = valor_map.get(cat_id, CERO) + stock * (
                fila['producto__costo_base_moneda_principal'] or CERO
            )

        categorias = set(stock_map) | set(vendido_map)
        resultados = []
        for cat_id in categorias:
            info_stock = stock_map.get(cat_id, {'nombre': 'S/C', 'stock': CERO})
            info_venta = vendido_map.get(cat_id, {'unidades': CERO})
            stock = info_stock['stock']
            unidades = info_venta['unidades']
            rotacion = float(unidades / stock) if stock > 0 else None
            resultados.append({
                'categoria': info_stock['nombre'],
                'unidades_vendidas': float(unidades),
                'stock_actual': float(stock),
                'rotacion': rotacion,
                'valor_stock': float(valor_map.get(cat_id, CERO)),
            })

        resultados.sort(key=lambda r: r['rotacion'] or 0, reverse=True)

        resumen = {
            f'Período (días)': dias,
            'Categorías': len(resultados),
        }

        columnas = [
                {'campo': 'categoria', 'titulo': 'Categoría'},
                {'campo': 'unidades_vendidas', 'titulo': 'Unidades Vendidas (base)', 'formato': 'numero'},
                {'campo': 'stock_actual', 'titulo': 'Stock Actual (base)', 'formato': 'numero'},
                {'campo': 'rotacion', 'titulo': 'Rotación', 'formato': 'numero'},
                {'campo': 'valor_stock', 'titulo': 'Valor Stock', 'formato': 'moneda'},
            ]
        excel = self.exportar_excel(
            request, f'Rotación por Categoría (últimos {dias} días)', columnas, resultados,
            'rotacion_por_categoria.xlsx', resumen,
        )
        if excel:
            return excel

        return Response({
            'titulo': f'Rotación por Categoría (últimos {dias} días)',
            'columnas': columnas,
            'resultados': resultados,
            'resumen': resumen,
        }, status=status.HTTP_200_OK)
