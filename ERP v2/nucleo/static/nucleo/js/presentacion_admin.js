/**
 * presentacion_admin.js
 * Calcula en tiempo real: Costo y Margen de Ganancia
 * en el inline de Presentaciones del Admin de Producto.
 * 
 * Escucha cambios en:
 * - factor_conversion
 * - precio_venta_principal
 * 
 * Lee costo_base_moneda_principal del campo del producto padre.
 */

(function($) {
    'use strict';

    // Función principal que se ejecuta cuando el DOM está listo
    $(document).ready(function() {

        // El costo base del producto lo leemos del campo del formulario padre
        // Está en el fieldset de Costos
        function getCostoBase() {
            var costoInput = $('input[name="costo_base_moneda_principal"]');
            var val = parseFloat(costoInput.val());
            return isNaN(val) ? 0 : val;
        }

        // Calcula el costo de la presentación
        function calcularCosto(factor, costoBase) {
            return costoBase * factor;
        }

        // Calcula el margen de ganancia
        function calcularMargen(precio, costo) {
            if (costo === 0) return 100;
            return ((precio - costo) / costo) * 100;
        }

        // Actualiza las celdas de una fila específica del inline
        function actualizarFila($row) {
            var factorInput = $row.find('input[name$="-factor_conversion"]');
            var precioInput = $row.find('input[name$="-precio_venta_principal"]');

            var factor = parseFloat(factorInput.val()) || 0;
            var precio = parseFloat(precioInput.val()) || 0;
            var costoBase = getCostoBase();

            var costo = calcularCosto(factor, costoBase);
            var margen = calcularMargen(precio, costo);

            // Buscamos las celdas readonly por su posición o clase
            // Django admin pone los campos readonly en <td> con clase .field-get_costo y .field-get_margen
            var $costoCell = $row.find('.field-get_costo');
            var $margenCell = $row.find('.field-get_margen');

            if ($costoCell.length) {
                $costoCell.text(costo.toFixed(2));
            }
            if ($margenCell.length) {
                $margenCell.text(margen.toFixed(2) + '%');
            }
        }

        // Escuchar cambios en los inputs del inline
        $(document).on('input', 'input[name$="-factor_conversion"], input[name$="-precio_venta_principal"]', function() {
            var $row = $(this).closest('tr');
            actualizarFila($row);
        });

        // Escuchar cambios en el costo base del producto (afecta TODAS las filas)
        $(document).on('input', 'input[name="costo_base_moneda_principal"]', function() {
            $('tr.form-row').each(function() {
                actualizarFila($(this));
            });
        });

        // Al cargar la página, calcular todas las filas existentes
        $('tr.form-row').each(function() {
            actualizarFila($(this));
        });

        // Django admin usa un template para agregar nuevas filas inline
        // Escuchamos cuando se agrega una nueva fila
        $(document).on('formset:added', function(event, $row, formsetName) {
            if (formsetName === 'presentaciones') {
                actualizarFila($row);
            }
        });

    });

})(django.jQuery);
