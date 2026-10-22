# ==============================================================================
# FASE 1.6 (Anexo B.8) — Captura programada de la tasa BCV del día
# ==============================================================================
"""
Comando de gestión para registrar la tasa BCV aunque nadie abra el POS.

Crontab sugerido (el BCV publica ~5pm; correr después):
    0 18 * * 1-5 cd /ruta/proyecto && python manage.py fetch_bcv_rate

El BCV no publica tasa fines de semana ni feriados: el comando simplemente no
crea fila esos días y el siguiente día hábil usa la última tasa registrada
(comportamiento correcto según Anexo B.9).
"""

from django.core.management.base import BaseCommand
from django.utils import timezone

from nucleo.models import ConfiguracionGlobal, TasaCambioDiaria
from nucleo.services.tasas import ProveedorTasaBCV


class Command(BaseCommand):
    help = "Consulta y registra la tasa BCV del día"

    def handle(self, *args, **options):
        config = ConfiguracionGlobal.objects.first()
        if not config or not config.usar_tasa_bcv:
            self.stdout.write("Feature desactivado (usar_tasa_bcv=False).")
            return

        hoy = timezone.localdate()
        existente = TasaCambioDiaria.objects.filter(fecha=hoy).first()

        # Ya hay tasa BCV registrada hoy (manual o automática): no se pisa.
        if existente and existente.tasa_bcv:
            self.stdout.write(f"Ya existe tasa BCV para {hoy}: {existente.tasa_bcv} ({existente.tasa_bcv_fuente}).")
            return

        resultado = ProveedorTasaBCV.consultar(config.bcv_timeout_segundos, force=True)
        if not resultado:
            self.stderr.write("✗ No se pudo obtener la tasa BCV (todas las fuentes fallaron).")
            return

        defaults = {
            'tasa_bcv': resultado['tasa'],
            'tasa_bcv_fuente': resultado['fuente'],
            'tasa_bcv_obtenida_el': resultado['obtenida_el'],
            'tasa_bcv_es_manual': False,
        }

        if existente:
            # Solo se completa el bloque BCV; tasa_negocio y motivo quedan intactos.
            for campo, valor in defaults.items():
                setattr(existente, campo, valor)
            existente.save(update_fields=list(defaults.keys()) + ['actualizado_el'])
            self.stdout.write(f"✓ Tasa BCV del {hoy} completada: {resultado['tasa']} ({resultado['fuente']})")
        else:
            TasaCambioDiaria.objects.create(
                fecha=hoy,
                tasa_negocio=config.tasa_cambio_actual,
                **defaults,
            )
            self.stdout.write(f"✓ Tasa BCV del {hoy} registrada: {resultado['tasa']} ({resultado['fuente']})")
