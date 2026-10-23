#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO DE VENTAS DEL DASHBOARD
===================================
Ejecutar desde la raíz del proyecto:

    python manage.py shell < scripts/diagnostico_ventas.py

No escribe nada: solo lee e imprime. Con la salida de los bloques A-G se sabe
EXACTAMENTE cuál de estas situaciones está inflando el "Acumulado del Mes":

  A. Fuente del mes (POS vs Rutas) y total por día  → ¿qué fuente pesa de más?
  B. Ventas cuyo total guardado NO coincide con la suma de sus productos
     (precio cargado en otra moneda / impuesto mal tipeado / carrito corrupto).
  C. Ventas duplicadas (misma operación facturada dos veces).
  D. Rutas con tasa de cambio sospechosa o con totales incoherentes.
  E. Ventas BORRADOR "zombi" (candidatas a procesarse dos veces).
  F. Catálogo con datos peligrosos (impuestos > 100%, precios desproporcionados).
  G. Rutas con fecha/hora ambigua (arrastre de fecha por huso horario).
"""

from collections import defaultdict
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db.models import Sum, Count
from django.utils import timezone

# ── Import robusto de los modelos (el app se llama "nucleo") ──────────────────
try:
    from nucleo.models import (
        Venta, RutaMercado, TasaCambioDiaria, Impuesto, PresentacionProducto,
        PagoVenta, PagoCuentaCobrar, CuentaPorCobrar, Cliente,
    )
except Exception:  # pragma: no cover
    from django.apps import apps
    Venta = apps.get_model('nucleo', 'Venta')
    RutaMercado = apps.get_model('nucleo', 'RutaMercado')
    TasaCambioDiaria = apps.get_model('nucleo', 'TasaCambioDiaria')
    Impuesto = apps.get_model('nucleo', 'Impuesto')
    PresentacionProducto = apps.get_model('nucleo', 'PresentacionProducto')
    PagoVenta = apps.get_model('nucleo', 'PagoVenta')
    PagoCuentaCobrar = apps.get_model('nucleo', 'PagoCuentaCobrar')
    CuentaPorCobrar = apps.get_model('nucleo', 'CuentaPorCobrar')
    Cliente = apps.get_model('nucleo', 'Cliente')


def D(v):
    return Decimal(str(v or '0'))


def titulo(txt):
    print("\n" + "=" * 78)
    print(txt)
    print("=" * 78)


ahora = timezone.localtime()
hoy = ahora.date()
inicio_mes = hoy.replace(day=1)
mes_anterior = (inicio_mes - timedelta(days=1)).replace(day=1)

inicio_mes_dt = timezone.make_aware(datetime.combine(inicio_mes, time.min))
fin_hoy_dt = timezone.make_aware(datetime.combine(hoy + timedelta(days=1), time.min))

ventas_mes = Venta.objects.filter(
    fecha__gte=inicio_mes_dt, fecha__lt=fin_hoy_dt, estado='PROCESADA'
).select_related('cliente').prefetch_related('detalles')

rutas_mes = RutaMercado.objects.filter(
    fecha__gte=inicio_mes_dt, fecha__lt=fin_hoy_dt, estado='CERRADA'
).prefetch_related('detalles')

total_pos = sum((v.total_principal for v in ventas_mes), Decimal('0.00'))
total_rutas = sum((r.total_venta_usd for r in rutas_mes), Decimal('0.00'))

# ═════════════════════════════════════════════════════════════════════════════
titulo(f"A. FUENTE DEL MES  ({inicio_mes:%d/%m/%Y} .. {hoy:%d/%m/%Y})")
# ═════════════════════════════════════════════════════════════════════════════
print(f"  POS  (Venta.estado='PROCESADA') ......... ${total_pos:>12,.2f}   ({ventas_mes.count()} facturas)")
print(f"  Rutas (RutaMercado.estado='CERRADA') .... ${total_rutas:>12,.2f}   ({rutas_mes.count()} rutas)")
print(f"  TOTAL que muestra el dashboard .......... ${total_pos + total_rutas:>12,.2f}")
print("\n  Por día (solo días con movimiento):")
por_dia = defaultdict(lambda: [Decimal('0.00'), Decimal('0.00'), 0, 0])
for v in ventas_mes:
    d = timezone.localtime(v.fecha).date()
    por_dia[d][0] += v.total_principal
    por_dia[d][2] += 1
for r in rutas_mes:
    d = timezone.localtime(r.fecha).date()
    por_dia[d][1] += r.total_venta_usd
    por_dia[d][3] += 1
for d in sorted(por_dia):
    pos, rut, nv, nr = por_dia[d]
    print(f"    {d:%d/%m}  POS ${pos:>10,.2f} ({nv:>2} fac)   Rutas ${rut:>10,.2f} ({nr} ruta)   -> ${pos + rut:>10,.2f}")

# ═════════════════════════════════════════════════════════════════════════════
titulo("B. TOTALES QUE NO COINCIDEN CON SUS PRODUCTOS  (dato corrupto)")
# ═════════════════════════════════════════════════════════════════════════════
# Si aparecen filas aquí, el total guardado es mayor que lo que realmente
# se vendió línea por línea → esa diferencia es EXACTAMENTE lo que infla el mes.
encontrados = 0
for v in sorted(ventas_mes, key=lambda x: -x.total_principal):
    calc = Decimal('0.00')
    for d in v.detalles.all():
        linea = (D(d.cantidad_presentacion) * D(d.precio_unitario_aplicado)).quantize(Decimal('0.01'))
        calc += linea + (linea * D(d.porcentaje_impuesto_aplicado) / Decimal('100')).quantize(Decimal('0.01'))
    if abs(calc - v.total_principal) > Decimal('0.05'):
        encontrados += 1
        print(f"  Venta #{v.id:>5} {timezone.localtime(v.fecha):%d/%m %H:%M}  "
              f"guardado=${v.total_principal:>10,.2f}  calculado=${calc:>10,.2f}  "
              f"dif=${v.total_principal - calc:>10,.2f}  cliente={v.cliente.nombre}")
if not encontrados:
    print("  ✅ Todas las ventas del mes cuadran con sus productos.")

print("\n  Top 10 ventas del mes (para detectar valores fuera de escala):")
for v in sorted(ventas_mes, key=lambda x: -x.total_principal)[:10]:
    print(f"    #{v.id:>5} {timezone.localtime(v.fecha):%d/%m %H:%M} ${v.total_principal:>12,.2f}  "
          f"BS {v.total_secundaria:>14,.2f}  tasa {v.tasa_cambio_historica}  {v.cliente.nombre}")

# ═════════════════════════════════════════════════════════════════════════════
titulo("C. POSIBLES VENTAS DUPLICADAS  (misma operación facturada 2 veces)")
# ═════════════════════════════════════════════════════════════════════════════
firmas = defaultdict(list)
for v in ventas_mes:
    firma = (
        v.cliente_id, v.total_principal, timezone.localtime(v.fecha).date(),
        len(v.detalles.all()),
    )
    firmas[firma].append(v)
dup = 0
for firma, grupo in sorted(firmas.items(), key=lambda kv: -len(kv[1])):
    if len(grupo) > 1:
        dup += 1
        ids = ", ".join(f"#{v.id}({timezone.localtime(v.fecha):%H:%M:%S})" for v in grupo)
        print(f"  ⚠ {len(grupo)} ventas iguales (${firma[1]:,.2f}, cliente_id={firma[0]}, "
              f"{firma[2]:%d/%m}, {firma[3]} productos): {ids}")
if not dup:
    print("  ✅ No hay ventas repetidas con la misma firma.")

print("\n  Posibles RUTAS duplicadas:")
firmas_r = defaultdict(list)
for r in rutas_mes:
    firmas_r[(r.almacen_id, r.total_venta_usd, timezone.localtime(r.fecha).date())].append(r)
dup_r = 0
for firma, grupo in sorted(firmas_r.items(), key=lambda kv: -len(kv[1])):
    if len(grupo) > 1:
        dup_r += 1
        ids = ", ".join(f"#{r.id}(${r.total_venta_usd:,.2f})" for r in grupo)
        print(f"  ⚠ {len(grupo)} rutas del {firma[2]:%d/%m} con el mismo total (${firma[1]:,.2f}): {ids}")
if not dup_r:
    print("  ✅ No hay rutas repetidas con la misma firma.")

# ═════════════════════════════════════════════════════════════════════════════
titulo("D. RUTAS: TASA DE CAMBIO Y COHERENCIA DE TOTALES")
# ═════════════════════════════════════════════════════════════════════════════
print("  Rutas del mes (ordenadas por total USD):")
for r in sorted(rutas_mes, key=lambda x: -x.total_venta_usd)[:10]:
    # tasa oficial del día (si existe)
    dia = timezone.localtime(r.fecha).date()
    tasa_oficial = TasaCambioDiaria.objects.filter(fecha=dia).first()
    aviso = ""
    if tasa_oficial and tasa_oficial.tasa_negocio:
        try:
            dif = abs(D(r.tasa_cambio) - D(tasa_oficial.tasa_negocio)) / D(tasa_oficial.tasa_negocio) * 100
            if dif > Decimal('10'):
                aviso = f"  ⚠ tasa {dif:.0f}% distinta de la del día ({tasa_oficial.tasa_negocio})"
        except Exception:
            pass
    if D(r.tasa_cambio) <= 0:
        aviso += "  ⚠ TASA EN CERO"
    esperado = (D(r.total_venta_bs) / D(r.tasa_cambio)).quantize(Decimal('0.01')) if D(r.tasa_cambio) > 0 else Decimal('0')
    if abs(esperado - D(r.total_venta_usd)) > Decimal('0.05'):
        aviso += f"  ⚠ total_usd guardado ${r.total_venta_usd} != BS/tasa ${esperado}"
    print(f"    #{r.id:>4} {dia:%d/%m}  USD {r.total_venta_usd:>10,.2f}  BS {r.total_venta_bs:>12,.2f}  "
          f"tasa {r.tasa_cambio:>8}{aviso}")

# ═════════════════════════════════════════════════════════════════════════════
titulo("E. VENTAS BORRADOR 'ZOMBI'  (candidatas a procesarse dos veces)")
# ═════════════════════════════════════════════════════════════════════════════
desde = timezone.now() - timedelta(days=60)
zombies = Venta.objects.filter(
    estado='BORRADOR', fecha__gte=desde
).exclude(total_principal=0).order_by('-fecha')
if zombies:
    print("  ⚠ Estas ventas quedaron en BORRADOR con total válido. Si alguien las")
    print("    'procesa' a mano mientras el cajero ya rehizo la venta, el mes se cuenta doble:")
    for v in zombies[:20]:
        print(f"    #{v.id:>5} {timezone.localtime(v.fecha):%d/%m %H:%M}  ${v.total_principal:>10,.2f}  "
              f"{v.cliente.nombre}  ({v.usuario.username})")
    print(f"    ... total: {zombies.count()} ventas BORRADOR con monto en los últimos 60 días.")
    print("    RECOMENDACIÓN: revisar una por una y anularlas (acción del admin) si la venta real ya se facturó.")
else:
    print("  ✅ No hay ventas BORRADOR con monto recientes.")

# ═════════════════════════════════════════════════════════════════════════════
titulo("F. CATÁLOGO CON DATOS PELIGROSOS")
# ═════════════════════════════════════════════════════════════════════════════
malos = Impuesto.objects.filter(porcentaje__gt=100) | Impuesto.objects.filter(porcentaje__lt=0)
if malos:
    for i in malos.distinct():
        print(f"  ⚠ Impuesto '{i.nombre}' con porcentaje {i.porcentaje}% (¿se escribió 1600 en vez de 16?)")
else:
    print("  ✅ Impuestos dentro de rango 0-100%.")

raros = 0
for p in PresentacionProducto.objects.select_related('producto').all():
    costo = D(p.producto.costo_base_moneda_principal) * D(p.factor_conversion)
    precio = D(p.precio_venta_principal)
    if precio <= 0:
        print(f"  ⚠ {p.producto.nombre} ({p}): precio de venta {precio}")
        raros += 1
    elif costo > 0 and precio > costo * 50:
        print(f"  ⚠ {p.producto.nombre} ({p}): precio ${precio} vs costo ${costo} "
              f"({(precio / costo):.0f}x) — ¿precio cargado en otra moneda?")
        raros += 1
if not raros:
    print("  ✅ Precios de venta razonables frente al costo.")

# ═════════════════════════════════════════════════════════════════════════════
titulo("G. RUTAS CON FECHA/HORA AMBIGUA  (arrastre de fecha por huso horario)")
# ═════════════════════════════════════════════════════════════════════════════
# El bug clásico: crear/editar la ruta después de las 8pm (UTC-4) guardaba la
# fecha del día SIGUIENTE (toISOString() es UTC). Así un mercado del 31 se
# contabilizaba el día 1 del mes siguiente y "hinchaba" el acumulado.
ambiguas = 0
for r in RutaMercado.objects.filter(fecha__gte=timezone.now() - timedelta(days=90)).order_by('-fecha'):
    local = timezone.localtime(r.fecha)
    if local.time() != time(0, 0):
        ambiguas += 1
        print(f"  ⚠ Ruta #{r.id} registrada a las {local:%d/%m/%Y %H:%M} (hora con minutos). "
              "Revisa que el día asignado sea el día real del mercado.")
if not ambiguas:
    print("  ✅ Todas las rutas de los últimos 90 días están a medianoche local.")

# ═══════════════════════════════════════════════════════════════════════
titulo("H. ¿CUÁNTO DE ESA 'VENTA' ES DINERO REAL?  (contado vs crédito vs fiado)")
# ═══════════════════════════════════════════════════════════════════════
# El KPI del dashboard es INGRESO BRUTO: cuenta lo vendido, no lo cobrado.
# Aquí se ve la diferencia entre "lo que dice el dashboard" y "lo que entró".
contado = ventas_mes.filter(tipo='CONTADO').aggregate(t=Sum('total_principal'), n=Count('id'))
credito = ventas_mes.filter(tipo='CREDITO').aggregate(t=Sum('total_principal'), n=Count('id'))

pagos_pos = PagoVenta.objects.filter(venta__in=ventas_mes).aggregate(
    t=Sum('monto_equivalente_principal'))
fiado_pendiente = CuentaPorCobrar.objects.filter(venta__in=ventas_mes).aggregate(
    t=Sum('saldo_pendiente'))

abonos_modulo = PagoCuentaCobrar.objects.filter(
    fecha__gte=inicio_mes_dt, fecha__lt=fin_hoy_dt,
    origen__in=['ABONO_CXC', 'ABONO_MASIVO'],
).aggregate(t=Sum('monto_abono_principal'), n=Count('id'))

print(f"  Ventas CONTADO del mes .............. ${D(contado['t']):>12,.2f}  ({contado['n']} facturas)")
print(f"  Ventas CRÉDITO (fiado) del mes ...... ${D(credito['t']):>12,.2f}  ({credito['n']} facturas)")
print(f"     └ de ese fiado, sigue pendiente .. ${D(fiado_pendiente['t']):>12,.2f}")
print(f"  Cobrado en el POS por ventas del mes  ${D(pagos_pos['t']):>12,.2f}")
print(f"  Cobranzas de deudas de otros meses ... ${D(abonos_modulo['t']):>12,.2f}  ({abonos_modulo['n']} abonos)")
print("  " + "-" * 60)
print(f"  DASHBOARD (ingreso bruto) ........... ${total_pos + total_rutas:>12,.2f}")
print(f"  DINERO REALMENTE ENTRADO aprox. ..... ${D(pagos_pos['t']) + D(abonos_modulo['t']) + total_rutas:>12,.2f}")
print("     (pagos POS + cobranzas de deudas viejas + rutas de mercado)")
print("\n  👉 Si el primer número es mucho mayor que el segundo, el 'exceso' del")
print("     dashboard son ventas a CRÉDITO (fiado) que aún no han entrado en caja.")

print("\n  Las 10 facturas más grandes del mes, con su tipo:")
for v in sorted(ventas_mes, key=lambda x: -x.total_principal)[:10]:
    cxc = CuentaPorCobrar.objects.filter(venta=v).first()
    saldo = cxc.saldo_pendiente if cxc else Decimal('0.00')
    print(f"    #{v.id:>5} {timezone.localtime(v.fecha):%d/%m} {v.tipo:<8} ${v.total_principal:>10,.2f}  "
          f"fiado aún: ${saldo:>9,.2f}  {v.cliente.nombre}")

# ═══════════════════════════════════════════════════════════════════════
titulo("I. ¿CÓMO SE LIQUIDÓ EL FIADO DEL MES?  (orígenes del dinero)")
# ═══════════════════════════════════════════════════════════════════════
# El bloque H mostró que de las ventas a crédito del mes se "liquidaron"
# $35k pero solo se vio una fracción de dinero. Aquí se ve EN QUÉ MONEDA
# DE PAGO se hizo cada liquidación (PagoCuentaCobrar.origen).
liquidado = D(credito['t']) - D(fiado_pendiente['t'])
print(f"  Ventas a crédito del mes ............. ${D(credito['t']):>12,.2f}")
print(f"  Deuda de esas ventas ya liquidada .... ${liquidado:>12,.2f}")
print(f"  Deuda todavía pendiente .............. ${D(fiado_pendiente['t']):>12,.2f}")
print("\n  Pagos registrados sobre esas deudas, por ORIGEN:")
por_origen = (PagoCuentaCobrar.objects
              .filter(cuenta__venta__in=ventas_mes)
              .values('origen')
              .annotate(t=Sum('monto_abono_principal'), n=Count('id'))
              .order_by('-t'))
suma_pagos = Decimal('0.00')
for fila in por_origen:
    suma_pagos += D(fila['t'])
    nota = {
        'COBRO_POS': '(dinero del POS, ya contado en PagoVenta)',
        'SALDO_FAVOR': '(pagado con saldo a favor: SIN dinero nuevo)',
        'VUELTO_VENTA': '(vuelto de otra venta aplicado: SIN dinero nuevo)',
        'ABONO_CXC': '(abono manual desde el módulo de clientes / admin)',
        'ABONO_MASIVO': '(abono masivo)',
    }.get(fila['origen'] or '', '')
    print(f"    {str(fila['origen']):<15} ${D(fila['t']):>12,.2f}  ({fila['n']} pagos) {nota}")
if not por_origen:
    print("    (no hay pagos registrados sobre esas deudas)")
print("  " + "-" * 60)
print(f"  Suma de pagos registrados ............ ${suma_pagos:>12,.2f}")
dif = liquidado - suma_pagos
if abs(dif) > Decimal('0.05'):
    print(f"  ⚠ DIFERENCIA sin explicar ............ ${dif:>12,.2f}")
    print("    → La deuda bajó SIN un pago que lo respalde (edición manual en el admin,")
    print("      ajuste de saldo_pendiente o un flujo que no deja registro). Revisar.")
else:
    print("  ✅ Cada dólar de deuda liquidada tiene su pago registrado.")

print("\n  💰 Saldo a favor acumulado de los clientes (top 10):")
for c in Cliente.objects.exclude(saldo_a_favor=0).order_by('-saldo_a_favor')[:10]:
    print(f"    {c.nombre:<30} ${c.saldo_a_favor:>10,.2f}")

print("\n  🧺 Cobranzas registradas en RUTAS del mes (total_cobranzas_bs):")
cobranzas_bs = rutas_mes.aggregate(t=Sum('total_cobranzas_bs'))['t'] or Decimal('0.00')
print(f"    Total: BS {cobranzas_bs:,.2f}")
print("    ⚠ OJO: este dinero se cobra en el mercado por deudas viejas, pero")
print("      cerrar_ruta() NUNCA lo aplica a las CxC del cliente: queda solo como")
print("      un número en el cuadre de la ruta. Si aquí se cobró, la deuda sigue")
print("      viva en el sistema y alguien más la está cancelando por otra vía.")

print("\n  👛 Top 10 clientes con deuda PENDIENTE total (todas las épocas):")
ranking = (CuentaPorCobrar.objects.filter(estado__in=['PENDIENTE', 'VENCIDA'])
           .values('cliente__nombre')
           .annotate(t=Sum('saldo_pendiente'), n=Count('id'))
           .order_by('-t')[:10])
for fila in ranking:
    print(f"    {str(fila['cliente__nombre']):<30} ${D(fila['t']):>10,.2f}  ({fila['n']} facturas)")

titulo("FIN DEL DIAGNÓSTICO — pega esta salida completa para analizarla")
