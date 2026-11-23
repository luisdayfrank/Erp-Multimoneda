# ==============================================================================
# MANTENIMIENTO — Recalcular totales de las rutas de mercado
# ==============================================================================
"""
Recalcula los campos derivados de RutaMercado usando la fórmula oficial
(RutaMercado.calcular_totales): ventas, pagos, créditos, gastos, recaudado
y diferencia.

Uso:
    python manage.py recalcular_rutas_mercado

Corrige rutas cuyo snapshot de totales quedó desfasado respecto a sus
detalles/pagos/créditos/gastos (por ejemplo, por ediciones hechas en el
admin o por datos históricos). No modifica los registros hijos ni el estado.
"""

from django.core.management.base import BaseCommand

from nucleo.models import RutaMercado


CAMPOS_DERIVADOS = [
    'total_venta_bs', 'total_venta_usd',
    'total_efectivo_bs', 'total_pago_movil_bs', 'total_punto_venta_bs',
    'total_creditos_bs', 'total_gastos_bs',
    'recaudado_esperado_bs', 'recaudado_real_bs', 'diferencia_bs',
]


class Command(BaseCommand):
    help = "Recalcula los totales y la diferencia guardada de las rutas de mercado"

    def handle(self, *args, **options):
        rutas = (
            RutaMercado.objects
            .prefetch_related('detalles', 'pagos__metodo', 'creditos', 'gastos')
            .order_by('id')
        )

        revisadas = 0
        corregidas = 0

        for ruta in rutas:
            revisadas += 1
            antes = {campo: getattr(ruta, campo) for campo in CAMPOS_DERIVADOS}

            ruta.calcular_totales()

            despues = {campo: getattr(ruta, campo) for campo in CAMPOS_DERIVADOS}
            if antes == despues:
                continue

            ruta.save(update_fields=CAMPOS_DERIVADOS)
            corregidas += 1
            self.stdout.write(
                f"Ruta #{ruta.id}: diferencia BS "
                f"{antes['diferencia_bs']} -> {despues['diferencia_bs']}"
            )

        self.stdout.write(self.style.SUCCESS(
            f"Rutas revisadas: {revisadas}. Rutas corregidas: {corregidas}."
        ))
