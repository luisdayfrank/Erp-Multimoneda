# ==============================================================================
# FASE 1B — Servicio de Cierre de Caja
# ==============================================================================
"""
Calcula el cierre real de una sesión de caja y crea la foto inmutable
(CierreCaja + CierrePorMetodoPago).

REGLA ANTI DOBLE CONTEO (bug documentado en el análisis):
    El dinero de una venta queda registrado en PagoVenta (fuente canónica).
    Cuando `Venta.procesar_venta` aplica ese mismo dinero a CxC (PASO 1 / PASO 6)
    crea PagoCuentaCobrar con origen='COBRO_POS' → esos registros se EXCLUEN del
    "cobrado" del turno para no contar el dinero dos veces. Aun así aparecen en
    la sección informativa "Abonos a cuentas viejas" del reporte.

FUENTES DE DINERO DEL TURNO (esperado por método):
    A) PagoVenta de las ventas PROCESADAS de la sesión        (venta contado/crédito)
    B) ReciboAbono de la sesión con origen ABONO_MASIVO /
       ABONO_CXC → se usa su `desglose_metodos` (JSON)        (abonos a deuda vieja)
    NO suman: recibos POS_VENTA (ya están en A), pagos con
    saldo a favor (no hubo dinero), abonos sin sesión (offline, se listan como
    información), cobros de ruta (tienen su propio cuadre de ruta).

CAJA FÍSICA (gaveta):
    esperado = fondo_inicial
             + cobros por métodos de EFECTIVO
             - egresos de efectivo (por moneda)
             - vueltos entregados físicamente
"""

from collections import defaultdict
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from .models import (
    CierreCaja,
    CierrePorMetodoPago,
    ConfiguracionGlobal,
    PagoCuentaCobrar,
    PagoVenta,
    ReciboAbono,
    Venta,
)

CERO = Decimal('0.00')
VERSION_CALCULO = 'fase1b-v1'

# Orígenes de PagoCuentaCobrar cuyo dinero YA está contado como PagoVenta
ORIGENES_YA_CONTADOS = ('COBRO_POS',)
# Orígenes que no representan dinero entrante (pagos con saldo a favor)
ORIGENES_SIN_DINERO = ('SALDO_FAVOR',)
# Recibos cuyo desglose = dinero realmente recibido en el turno
ORIGENES_RECIBO_DINERO = ('ABONO_MASIVO', 'ABONO_CXC')
# Recibos que duplican el dinero de PagoVenta (venta POS) → no se suman otra vez
ORIGENES_RECIBO_POS = ('POS_VENTA',)


def _dec(valor):
    """Convierte valores de JSON/float a Decimal de forma segura."""
    if valor is None:
        return CERO
    if isinstance(valor, Decimal):
        return valor
    return Decimal(str(valor))


def calcular_preview(sesion):
    """
    Calcula TODOS los números del cierre sin guardar nada.
    Devuelve un dict plano y serializable a JSON.
    """
    config = ConfiguracionGlobal.objects.first()
    tasa_cierre = config.tasa_cambio_actual if config else Decimal('1.00')
    if tasa_cierre <= 0:
        tasa_cierre = Decimal('1.00')
    tasa_apertura = sesion.tasa_apertura or tasa_cierre

    # ------------------------------------------------------------------
    # 1. VENTAS DEL TURNO (solo PROCESADA; ANULADA no cuenta)
    # ------------------------------------------------------------------
    ventas = Venta.objects.filter(sesion_caja=sesion, estado='PROCESADA')
    agg_ventas = ventas.aggregate(
        total=Sum('total_principal'),
        total_bs=Sum('total_secundaria'),
        n=Count('id'),
    )
    agg_contado = ventas.filter(tipo='CONTADO').aggregate(total=Sum('total_principal'))
    agg_credito = ventas.filter(tipo='CREDITO').aggregate(total=Sum('total_principal'))

    total_facturado = agg_ventas['total'] or CERO
    total_contado = agg_contado['total'] or CERO
    total_credito_emitido = agg_credito['total'] or CERO
    num_facturas = agg_ventas['n'] or 0
    ticket_promedio = (total_facturado / num_facturas).quantize(Decimal('0.01')) if num_facturas else CERO

    # ------------------------------------------------------------------
    # 2. ESPERADO POR MÉTODO DE PAGO (moneda del método)
    # ------------------------------------------------------------------
    # estructura: clave -> {'metodo_id', 'nombre', 'moneda', 'es_efectivo', 'monto', 'equivalente'}
    # clave = metodo_id (int) o ('sin_metodo', moneda) para pagos sin método asignado.
    esperado = {}

    def _fila(metodo_id, nombre, moneda, es_efectivo):
        moneda = moneda or 'PRINCIPAL'
        key = metodo_id if metodo_id else ('sin_metodo', moneda)
        if key not in esperado:
            esperado[key] = {
                'metodo_id': metodo_id,
                'es_sin_metodo': metodo_id is None,
                'nombre': nombre or '(SIN MÉTODO — asignar en admin)',
                'moneda': moneda,
                'es_efectivo': bool(es_efectivo),
                'monto': CERO,
                'equivalente': CERO,
            }
        return esperado[key]

    # A) Pagos de ventas del turno (fuente canónica del dinero de ventas)
    pagos_venta = (
        PagoVenta.objects
        .filter(venta__sesion_caja=sesion, venta__estado='PROCESADA')
        .values('metodo_id', 'metodo__nombre', 'metodo__moneda_referencia', 'metodo__es_efectivo')
        .annotate(monto=Sum('monto_pagado'), equiv=Sum('monto_equivalente_principal'))
    )
    for p in pagos_venta:
        fila = _fila(p['metodo_id'], p['metodo__nombre'], p['metodo__moneda_referencia'], p['metodo__es_efectivo'])
        fila['monto'] += p['monto'] or CERO
        fila['equivalente'] += p['equiv'] or CERO

    # B) Abonos reales recibidos en el turno (por desglose del recibo)
    recibos_dinero = ReciboAbono.objects.filter(
        sesion_caja=sesion, origen__in=ORIGENES_RECIBO_DINERO
    ).select_related('cliente', 'usuario')

    total_abonos_recibos = CERO
    abonos_sin_clasificar = 0
    for recibo in recibos_dinero:
        total_abonos_recibos += recibo.monto_total_entregado or CERO
        for item in (recibo.desglose_metodos or []):
            metodo_id = item.get('metodo_id')
            monto = _dec(item.get('monto_pagado'))
            equiv = _dec(item.get('monto_equivalente_usd', item.get('monto_equivalente_principal')))
            if not metodo_id:
                # Sin método asignado → fila aparte visible para corregir en admin.
                # Se asume efectivo probable (el abono de mostrador suele serlo) para
                # no distorsionar la gaveta; la advertencia del preview lo señala.
                fila = _fila(None, None, item.get('moneda'), True)
                abonos_sin_clasificar += 1
            else:
                fila = _fila(metodo_id, item.get('metodo_nombre'), item.get('moneda'), None)
                # moneda/es_efectivo reales se completan desde el catálogo (abajo).
            fila['monto'] += monto
            fila['equivalente'] += equiv

    # Completar nombre/moneda/es_efectivo desde el catálogo (para filas de recibos)
    from .models import MetodoPago
    metodos_catalogo = {
        m.id: m for m in MetodoPago.objects.filter(
            id__in=[k for k in esperado if isinstance(k, int)]
        )
    }
    for key, fila in esperado.items():
        m = metodos_catalogo.get(fila['metodo_id']) if isinstance(key, int) else None
        if m:
            fila['nombre'] = m.nombre
            fila['moneda'] = m.moneda_referencia
            fila['es_efectivo'] = m.es_efectivo

    # Cobros por moneda (todos los métodos) y solo efectivo
    cobros_efectivo_principal = CERO
    cobros_efectivo_secundaria = CERO
    for fila in esperado.values():
        if fila['es_efectivo']:
            if fila['moneda'] == 'SECUNDARIA':
                cobros_efectivo_secundaria += fila['monto']
            else:
                cobros_efectivo_principal += fila['equivalente']

    # ------------------------------------------------------------------
    # 3. ABONOS A CUENTAS VIEJAS (info del reporte; sin doble conteo)
    #    Excluye: pagos con saldo a favor y el abono inicial a la CxC nueva
    #    de esta misma sesión (ese dinero ya está en PagoVenta).
    # ------------------------------------------------------------------
    abonos_viejas_qs = (
        PagoCuentaCobrar.objects
        .filter(sesion_caja=sesion)
        .exclude(origen__in=ORIGENES_SIN_DINERO)
        .exclude(cuenta__venta__sesion_caja=sesion)
    )
    agg_abonos_viejas = abonos_viejas_qs.aggregate(total=Sum('monto_abono_principal'), n=Count('id'))
    total_abonos_cxc = agg_abonos_viejas['total'] or CERO
    cantidad_abonos_cxc = agg_abonos_viejas['n'] or 0

    # ------------------------------------------------------------------
    # 4. DINERO COBRADO (real, sin doble conteo)
    # ------------------------------------------------------------------
    total_pagos_venta = PagoVenta.objects.filter(
        venta__sesion_caja=sesion, venta__estado='PROCESADA'
    ).aggregate(t=Sum('monto_equivalente_principal'))['t'] or CERO
    total_cobrado = total_pagos_venta + total_abonos_recibos

    # ------------------------------------------------------------------
    # 5. CRÉDITO GENERADO EN EL TURNO (saldo snapshot de CxC de las ventas)
    # ------------------------------------------------------------------
    from .models import CuentaPorCobrar
    agg_cxc_nuevas = CuentaPorCobrar.objects.filter(
        venta__sesion_caja=sesion
    ).aggregate(total=Sum('saldo_pendiente'), n=Count('id'))
    total_credito_generado = agg_cxc_nuevas['total'] or CERO

    # ------------------------------------------------------------------
    # 6. EGRESOS DE EFECTIVO (por moneda extraída)
    # ------------------------------------------------------------------
    egresos_qs = sesion.egresos_efectivo.select_related('concepto', 'usuario').order_by('fecha')
    egresos_principal = CERO
    egresos_secundaria = CERO
    egresos_detalle = []
    for e in egresos_qs:
        if e.moneda_extraida == 'SECUNDARIA':
            egresos_secundaria += e.monto_extraido
        else:
            egresos_principal += e.monto_extraido
        egresos_detalle.append({
            'id': e.id,
            'fecha': timezone.localtime(e.fecha).strftime('%d/%m %H:%M'),
            'concepto': e.concepto.nombre if e.concepto else '',
            'monto_extraido': float(e.monto_extraido),
            'moneda_extraida': e.moneda_extraida,
            'observacion': e.observacion or '',
        })

    # ------------------------------------------------------------------
    # 7. VUELTOS DEL TURNO
    # ------------------------------------------------------------------
    agg_vueltos = ventas.aggregate(
        total=Sum('vuelto_total_principal'),
        entregado_p=Sum('vuelto_entregado_principal'),
        entregado_s=Sum('vuelto_entregado_secundaria'),
        aplicado=Sum('vuelto_aplicado_cxc_principal'),
        saldo=Sum('vuelto_a_saldo_favor_principal'),
    )
    vuelto_total_generado = agg_vueltos['total'] or CERO
    vuelto_entregado_principal = agg_vueltos['entregado_p'] or CERO
    vuelto_entregado_secundaria = agg_vueltos['entregado_s'] or CERO
    vuelto_aplicado_cxc = agg_vueltos['aplicado'] or CERO
    vuelto_saldo_favor = agg_vueltos['saldo'] or CERO
    vuelto_retenido = vuelto_aplicado_cxc + vuelto_saldo_favor

    # ------------------------------------------------------------------
    # 8. EFECTIVO ESPERADO EN GAVETA (por moneda)
    # ------------------------------------------------------------------
    efectivo_esperado_principal = (
        sesion.fondo_inicial_principal
        + cobros_efectivo_principal
        - egresos_principal
        - vuelto_entregado_principal
    )
    efectivo_esperado_secundaria = (
        sesion.fondo_inicial_secundaria
        + cobros_efectivo_secundaria
        - egresos_secundaria
        - vuelto_entregado_secundaria
    )

    # ------------------------------------------------------------------
    # 9. DIFERENCIA CAMBIARIA ESTIMADA
    #    Ventas con componente BS valorizadas a tasa histórica vs tasa de cierre
    # ------------------------------------------------------------------
    ventas_bs_hist = CERO   # ya en USD (tasa histórica de cada venta)
    ventas_bs_bs = CERO     # en BS
    for v in ventas.filter(total_secundaria__gt=0):
        ventas_bs_hist += v.total_principal
        ventas_bs_bs += v.total_secundaria
    ventas_bs_a_tasa_cierre = (ventas_bs_bs / tasa_cierre).quantize(Decimal('0.01'))
    diferencia_cambiaria = ventas_bs_a_tasa_cierre - ventas_bs_hist
    variacion_tasa_pct = (
        ((tasa_cierre - tasa_apertura) / tasa_apertura * 100).quantize(Decimal('0.01'))
        if tasa_apertura > 0 else CERO
    )

    # ------------------------------------------------------------------
    # 10. ABONOS OFFLINE (registrados sin sesión — no suman al arqueo)
    # ------------------------------------------------------------------
    offline_qs = PagoCuentaCobrar.objects.filter(
        sesion_caja__isnull=True, fecha__gte=sesion.fecha_apertura
    )
    if sesion.fecha_cierre:
        offline_qs = offline_qs.filter(fecha__lte=sesion.fecha_cierre)
    agg_offline = offline_qs.aggregate(total=Sum('monto_abono_principal'), n=Count('id'))

    # ------------------------------------------------------------------
    # 11. ARMAR RESPUESTA
    # ------------------------------------------------------------------
    por_metodo = []
    for key in sorted(esperado.keys(), key=lambda k: (isinstance(k, tuple), str(k))):
        fila = esperado[key]
        por_metodo.append({
            'metodo_id': fila['metodo_id'],
            'es_sin_metodo': fila['es_sin_metodo'],
            'nombre': fila['nombre'],
            'moneda': fila['moneda'],
            'es_efectivo': fila['es_efectivo'],
            'esperado_en_moneda': float(fila['monto']),
            'esperado_equivalente_principal': float(fila['equivalente']),
        })

    preview = {
        'version_calculo': VERSION_CALCULO,
        'sesion': {
            'id': sesion.id,
            'cajero': sesion.usuario.username if sesion.usuario else None,
            'fecha_apertura': timezone.localtime(sesion.fecha_apertura).strftime('%d/%m/%Y %H:%M'),
            'estado': sesion.estado,
        },
        'tasas': {
            'tasa_apertura': float(tasa_apertura),
            'tasa_cierre': float(tasa_cierre),
            'variacion_pct': float(variacion_tasa_pct),
        },
        'resumen': {
            'total_facturado_principal': float(total_facturado),
            'total_contado_principal': float(total_contado),
            'total_credito_emitido_principal': float(total_credito_emitido),
            'total_cobrado_principal': float(total_cobrado),
            'total_credito_generado_principal': float(total_credito_generado),
            'total_abonos_cxc_principal': float(total_abonos_cxc),
            'cantidad_abonos_cxc': cantidad_abonos_cxc,
            'num_facturas': num_facturas,
            'ticket_promedio_principal': float(ticket_promedio),
        },
        'por_metodo': por_metodo,
        'efectivo': {
            'fondo_inicial_principal': float(sesion.fondo_inicial_principal),
            'fondo_inicial_secundaria': float(sesion.fondo_inicial_secundaria),
            'cobros_efectivo_principal': float(cobros_efectivo_principal),
            'cobros_efectivo_secundaria': float(cobros_efectivo_secundaria),
            'egresos_principal': float(egresos_principal),
            'egresos_secundaria': float(egresos_secundaria),
            'vuelto_entregado_principal': float(vuelto_entregado_principal),
            'vuelto_entregado_secundaria': float(vuelto_entregado_secundaria),
            'esperado_principal': float(efectivo_esperado_principal),
            'esperado_secundaria': float(efectivo_esperado_secundaria),
        },
        'vueltos': {
            'total_generado_principal': float(vuelto_total_generado),
            'entregado_principal': float(vuelto_entregado_principal),
            'entregado_secundaria': float(vuelto_entregado_secundaria),
            'aplicado_cxc_principal': float(vuelto_aplicado_cxc),
            'saldo_favor_principal': float(vuelto_saldo_favor),
            'retenido_principal': float(vuelto_retenido),
        },
        'egresos': {
            'detalle': egresos_detalle,
            'total_principal': float(egresos_principal),
            'total_secundaria': float(egresos_secundaria),
        },
        'diferencia_cambiaria': {
            'ventas_bs_tasa_historica_principal': float(ventas_bs_hist),
            'ventas_bs_tasa_cierre_principal': float(ventas_bs_a_tasa_cierre),
            'diferencia_principal': float(diferencia_cambiaria),
        },
        'abonos_offline': {
            'cantidad': agg_offline['n'] or 0,
            'total_principal': float(agg_offline['total'] or CERO),
            'nota': 'Abonos registrados sin sesión (admin/offline): NO suman al arqueo de este turno.',
        },
        'advertencias': [],
    }

    if abonos_sin_clasificar:
        preview['advertencias'].append(
            f"{abonos_sin_clasificar} pago(s) de abonos SIN método asignado: "
            "asígnale(s) método en admin antes de confiar en el desglose por método."
        )
    if sesion.tasa_apertura is None:
        preview['advertencias'].append(
            "La sesión no tiene tasa_apertura (creada antes de la Fase 1A); se usó la tasa de cierre."
        )

    return preview


def crear_cierre(sesion, usuario, declarado_efectivo_principal,
                 declarado_efectivo_secundaria, declarado_por_metodo=None,
                 observacion='', firma_cajero=''):
    """
    Crea el CierreCaja + CierrePorMetodoPago (foto inmutable) y cierra la sesión.

    - declarado_efectivo_principal/secundaria: lo que el cajero cuenta físicamente (USD/BS).
    - declarado_por_metodo: lista opcional [{"metodo_id": 1, "declarado_en_moneda": "800.00"}].
      Solo tiene sentido real para métodos de efectivo; los electrónicos se marcan
      como conciliados por banco (declarado = esperado, descuadre = 0).

    Devuelve el CierreCaja creado. Lanza ValueError si la sesión ya tiene cierre.
    """
    from .models import MetodoPago

    declarado_p = _dec(declarado_efectivo_principal)
    declarado_s = _dec(declarado_efectivo_secundaria)

    declarado_map = {}
    for item in (declarado_por_metodo or []):
        if item.get('metodo_id') is not None:
            declarado_map[int(item['metodo_id'])] = _dec(item.get('declarado_en_moneda'))

    with transaction.atomic():
        if hasattr(sesion, 'cierre'):
            raise ValueError(f"La sesión #{sesion.id} ya tiene un cierre registrado.")

        preview = calcular_preview(sesion)
        tasa_cierre = _dec(preview['tasas']['tasa_cierre'])
        tasa_apertura = _dec(preview['tasas']['tasa_apertura'])

        efectivo = preview['efectivo']
        esperado_p = _dec(efectivo['esperado_principal'])
        esperado_s = _dec(efectivo['esperado_secundaria'])

        descuadre_p = declarado_p - esperado_p
        descuadre_s = declarado_s - esperado_s
        descuadre_total = descuadre_p + (descuadre_s / tasa_cierre).quantize(Decimal('0.01'))

        vueltos = preview['vueltos']
        resumen = preview['resumen']

        cierre = CierreCaja.objects.create(
            sesion=sesion,
            usuario_cierre=usuario,
            total_facturado_principal=_dec(resumen['total_facturado_principal']),
            total_cobrado_principal=_dec(resumen['total_cobrado_principal']),
            total_credito_generado_principal=_dec(resumen['total_credito_generado_principal']),
            total_abonos_cxc_principal=_dec(resumen['total_abonos_cxc_principal']),
            fondo_inicial_principal=sesion.fondo_inicial_principal,
            fondo_inicial_secundaria=sesion.fondo_inicial_secundaria,
            efectivo_esperado_principal=esperado_p,
            efectivo_esperado_secundaria=esperado_s,
            efectivo_declarado_principal=declarado_p,
            efectivo_declarado_secundaria=declarado_s,
            descuadre_principal=descuadre_p,
            descuadre_secundaria=descuadre_s,
            descuadre_total_principal=descuadre_total,
            vuelto_entregado_principal=_dec(vueltos['entregado_principal']),
            vuelto_entregado_secundaria=_dec(vueltos['entregado_secundaria']),
            vuelto_retenido_principal=_dec(vueltos['retenido_principal']),
            tasa_apertura=tasa_apertura,
            tasa_cierre=tasa_cierre,
            diferencia_cambiaria_estimada_principal=_dec(
                preview['diferencia_cambiaria']['diferencia_principal']
            ),
            snapshot_json={
                'preview': preview,
                'declarado_efectivo_principal': float(declarado_p),
                'declarado_efectivo_secundaria': float(declarado_s),
                'declarado_por_metodo': [
                    {'metodo_id': k, 'declarado_en_moneda': float(v)}
                    for k, v in declarado_map.items()
                ],
            },
            observacion=observacion or '',
            firma_cajero=firma_cajero or '',
        )

        # --- Filas por método ---
        efectivo_por_moneda = {
            'PRINCIPAL': declarado_p,
            'SECUNDARIA': declarado_s,
        }
        for fila in preview['por_metodo']:
            metodo_id = fila['metodo_id']
            esperado_moneda = _dec(fila['esperado_en_moneda'])
            esperado_equiv = _dec(fila['esperado_equivalente_principal'])

            if fila.get('es_sin_metodo') or metodo_id is None:
                # Fila "(SIN MÉTODO)": visible en snapshot + advertencia, sin fila
                # en CierrePorMetodoPago (no hay metodo_id real al que asociarla).
                continue

            metodo = MetodoPago.objects.get(pk=metodo_id)

            if metodo.es_efectivo:
                declarado_moneda = declarado_map.get(
                    metodo_id, efectivo_por_moneda.get(fila['moneda'], CERO)
                )
                descuadre_moneda = declarado_moneda - esperado_moneda
                observacion_fila = ''
            else:
                # Dinero electrónico: va al banco, no se arquea físicamente
                declarado_moneda = esperado_moneda
                descuadre_moneda = CERO
                observacion_fila = 'Liquidación bancaria (no se arquea en gaveta)'

            if metodo.moneda_referencia == 'SECUNDARIA':
                declarado_equiv = (declarado_moneda / tasa_cierre).quantize(Decimal('0.01'))
                descuadre_equiv = (descuadre_moneda / tasa_cierre).quantize(Decimal('0.01'))
            else:
                declarado_equiv = declarado_moneda
                descuadre_equiv = descuadre_moneda

            CierrePorMetodoPago.objects.create(
                cierre=cierre,
                metodo=metodo,
                moneda=metodo.moneda_referencia,
                esperado_en_moneda=esperado_moneda,
                esperado_equivalente_principal=esperado_equiv,
                declarado_en_moneda=declarado_moneda,
                declarado_equivalente_principal=declarado_equiv,
                descuadre_en_moneda=descuadre_moneda,
                descuadre_equivalente_principal=descuadre_equiv,
                observacion=observacion_fila,
            )

        # --- Cerrar la sesión (compatibilidad con los campos legacy) ---
        sesion.estado = 'CERRADA'
        sesion.fecha_cierre = timezone.now()
        sesion.reporte_cierre_principal = declarado_p
        sesion.reporte_cierre_secundaria = declarado_s
        sesion.save()

        return cierre


def cierre_minimo_para_legacy(sesion, usuario, declarado_p, declarado_s):
    """
    Helper para el endpoint LEGACY PUT /api/v1/pos/caja/ (cierre a ciegas).
    Crea el snapshot de cierre sin romper el flujo viejo: nunca lanza excepción.
    Devuelve el CierreCaja o None.
    """
    try:
        return crear_cierre(
            sesion, usuario,
            declarado_efectivo_principal=declarado_p,
            declarado_efectivo_secundaria=declarado_s,
            observacion='Cierre creado automáticamente por el flujo legacy (PUT /pos/caja/).',
        )
    except Exception:
        return None
