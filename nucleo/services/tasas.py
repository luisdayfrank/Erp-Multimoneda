# ==============================================================================
# FASE 1.6 (Anexo B) — Proveedor de tasa BCV con fallback en cascada
# ==============================================================================
"""
Consulta la tasa oficial del BCV (BS/USD) contra fuentes públicas, con
fallback entre múltiples APIs y cache en memoria (1 hora).

REGLAS DE SEGURIDAD (Anexo B.9):
    - Nunca se llama a este servicio si `ConfiguracionGlobal.usar_tasa_bcv=False`.
    - Cada fuente se intenta con timeout configurable (default 5s).
    - Si todas las fuentes fallan se devuelve None: el caller decide si
      permite la captura manual (tasa_bcv_es_manual=True).
    - Tasas <= 0 se rechazan como inválidas y se intenta la siguiente fuente.

Uso:
    from nucleo.services.tasas import ProveedorTasaBCV

    resultado = ProveedorTasaBCV.consultar(timeout=5)
    # resultado = {'tasa': Decimal, 'fuente': str, 'obtenida_el': datetime, 'cache': bool}
    # o None si todas las fuentes fallaron.
"""

import logging
from datetime import timedelta
from decimal import Decimal, InvalidOperation

import requests
from django.utils import timezone

logger = logging.getLogger(__name__)

# Cache en memoria para evitar martillar las APIs (TTL 1 hora, Anexo B.6)
_CACHE_TTL = timedelta(hours=1)
_cache = {'resultado': None, 'consultado_el': None}


class ProveedorTasaBCV:
    """Consulta la tasa BCV con fallback entre múltiples fuentes."""

    FUENTES = [
        {
            'nombre': 'dolarapi.com',
            'url': 'https://ve.dolarapi.com/v1/dolares/oficial',
            'extraer': lambda datos: datos.get('promedio'),
        },
        {
            'nombre': 'pydolarve.org',
            'url': 'https://pydolarve.org/api/v1/dollar?page=bcv',
            'extraer': lambda datos: datos.get('monitors', {}).get('bcv', {}).get('price'),
        },
    ]

    @classmethod
    def consultar(cls, timeout=5, force=False):
        """
        Devuelve {'tasa', 'fuente', 'obtenida_el', 'cache'} o None si todas
        las fuentes fallan. `force=True` ignora la cache (botón "Actualizar BCV").
        """
        ahora = timezone.now()

        # 1) Cache vigente (solo si no fueran consulta nueva)
        if not force and _cache['resultado'] and _cache['consultado_el']:
            if ahora - _cache['consultado_el'] < _CACHE_TTL:
                resultado = dict(_cache['resultado'])
                resultado['cache'] = True
                return resultado

        # 2) Fuentes en cascada
        for fuente in cls.FUENTES:
            try:
                resp = requests.get(fuente['url'], timeout=timeout)
                resp.raise_for_status()
                valor = fuente['extraer'](resp.json())
                if valor is None:
                    continue
                tasa = Decimal(str(valor))
                if tasa <= 0:
                    # Tasa inválida: se rechaza y se intenta la siguiente fuente
                    continue
                resultado = {
                    'tasa': tasa,
                    'fuente': fuente['nombre'],
                    'obtenida_el': ahora,
                    'cache': False,
                }
                _cache['resultado'] = dict(resultado)
                _cache['consultado_el'] = ahora
                return resultado
            except (requests.RequestException, InvalidOperation, ValueError, KeyError, TypeError) as e:
                logger.warning("Fuente %s falló: %s", fuente['nombre'], e)
                continue

        return None  # todas fallaron
