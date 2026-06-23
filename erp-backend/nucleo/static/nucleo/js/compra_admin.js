(function () {
  function parseDecimal(value) {
    if (!value) return 0.0;
    // Reemplazamos coma por punto para soportar formatos "latinos"
    var normalized = String(value).replace(",", ".");
    var num = parseFloat(normalized);
    return isNaN(num) ? 0.0 : num;
  }

  function updateDetalleRow(row) {
    var qtyInput = row.querySelector('input[name$="-cantidad_presentacion"]');
    var priceInput = row.querySelector('input[name$="-precio_unitario_aplicado"]');
    var subtotalInput = row.querySelector('input[name$="-subtotal"]');

    if (!qtyInput || !priceInput || !subtotalInput) {
      return;
    }

    var qty = parseDecimal(qtyInput.value);
    var price = parseDecimal(priceInput.value);
    var subtotal = qty * price;

    if (!isFinite(subtotal)) subtotal = 0.0;

    subtotalInput.value = subtotal.toFixed(2);
  }

  function recalcTotales() {
    // Filas dinámicas del inline de DetalleCompra en el admin
    var rows = document.querySelectorAll(
      "tr.dynamic-detallecompra_set, tr.dynamic-detallecompra_set.has_original"
    );

    var subtotal = 0.0;
    var totalImpuestos = 0.0;

    rows.forEach(function (row) {
      if (row.classList.contains("empty-form")) return;

      var deleteCheckbox = row.querySelector('input[name$="-DELETE"]');
      if (deleteCheckbox && deleteCheckbox.checked) return;

      updateDetalleRow(row);

      var subtotalInput = row.querySelector('input[name$="-subtotal"]');
      var porcentajeInput = row.querySelector(
        'input[name$="-porcentaje_impuesto_aplicado"]'
      );

      var sub = subtotalInput ? parseDecimal(subtotalInput.value) : 0.0;
      var porcentaje = porcentajeInput
        ? parseDecimal(porcentajeInput.value)
        : 0.0;

      subtotal += sub;
      totalImpuestos += sub * (porcentaje / 100.0);
    });

    var subtotalField = document.getElementById("id_subtotal_principal");
    var impuestosField = document.getElementById(
      "id_total_impuestos_principal"
    );
    var totalPrincipalField = document.getElementById("id_total_principal");
    var totalSecundariaField = document.getElementById("id_total_secundaria");
    var tasaField = document.getElementById("id_tasa_cambio_historica");

    if (subtotalField) subtotalField.value = subtotal.toFixed(2);
    if (impuestosField) impuestosField.value = totalImpuestos.toFixed(2);

    var totalPrincipal = subtotal + totalImpuestos;
    if (totalPrincipalField)
      totalPrincipalField.value = totalPrincipal.toFixed(2);

    if (tasaField && totalSecundariaField) {
      var tasa = parseDecimal(tasaField.value);
      var totalSec = totalPrincipal * tasa;
      if (!isFinite(totalSec)) totalSec = 0.0;
      totalSecundariaField.value = totalSec.toFixed(2);
    }
  }

  function onChangeHandler(e) {
    var name = e.target && e.target.name ? e.target.name : "";
    if (
      name.indexOf("-cantidad_presentacion") !== -1 ||
      name.indexOf("-precio_unitario_aplicado") !== -1 ||
      name.indexOf("-porcentaje_impuesto_aplicado") !== -1 ||
      name.indexOf("-impuesto") !== -1
    ) {
      var row = e.target.closest("tr.form-row");
      if (row) {
        // Si se cambió el impuesto, intentamos copiar el porcentaje desde la opción seleccionada
        if (name.indexOf("-impuesto") !== -1) {
          var select = e.target;
          var porcentajeInput = row.querySelector(
            'input[name$="-porcentaje_impuesto_aplicado"]'
          );
          if (porcentajeInput && select && select.selectedOptions.length) {
            // Extraemos el porcentaje desde el texto de la opción, que suele ser "IVA (16.00%)"
            var text = select.selectedOptions[0].textContent || "";
            var match = text.match(/([\d.,]+)\s*%/);
            if (match) {
              porcentajeInput.value = match[1].replace(",", ".");
            }
          }
        }
      }
      recalcTotales();
    }
  }

  document.addEventListener("change", onChangeHandler);
  document.addEventListener("DOMContentLoaded", function () {
    recalcTotales();
  });
})();

