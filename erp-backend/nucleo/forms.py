from decimal import Decimal

from django import forms

from .models import DetalleCompra, Impuesto


class DetalleCompraInlineForm(forms.ModelForm):
    """
    Formulario para el inline de DetalleCompra que:
    - Muestra un desplegable de impuestos (modelo Impuesto).
    - Calcula automáticamente el subtotal (cantidad * precio unitario).
    - Copia el porcentaje del impuesto seleccionado al campo porcentaje_impuesto_aplicado.
    """

    impuesto = forms.ModelChoiceField(
        queryset=Impuesto.objects.all(),
        required=False,
        label="Impuesto"
    )

    class Meta:
        model = DetalleCompra
        fields = (
            "presentacion",
            "cantidad_presentacion",
            "precio_unitario_aplicado",
            "impuesto",
            "porcentaje_impuesto_aplicado",  # campo del modelo
            "subtotal",                      # campo del modelo
        )

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Si ya hay un porcentaje guardado, intentamos preseleccionar el impuesto correspondiente
        porcentaje = getattr(self.instance, "porcentaje_impuesto_aplicado", None)
        if porcentaje is not None:
            impuesto = Impuesto.objects.filter(porcentaje=porcentaje).first()
            if impuesto:
                self.fields["impuesto"].initial = impuesto.pk

        # Hacemos los campos derivados solo lectura si existen en el formulario
        if "porcentaje_impuesto_aplicado" in self.fields:
            self.fields["porcentaje_impuesto_aplicado"].widget.attrs["readonly"] = True
        if "subtotal" in self.fields:
            self.fields["subtotal"].widget.attrs["readonly"] = True

    def clean(self):
        cleaned_data = super().clean()
        cantidad = cleaned_data.get("cantidad_presentacion") or Decimal("0.00")
        precio = cleaned_data.get("precio_unitario_aplicado") or Decimal("0.00")

        # Calculamos el subtotal siempre en el servidor
        cleaned_data["subtotal"] = cantidad * precio

        impuesto = cleaned_data.get("impuesto")
        if impuesto:
            cleaned_data["porcentaje_impuesto_aplicado"] = impuesto.porcentaje

        return cleaned_data

    def save(self, commit=True):
        instance = super().save(commit=False)

        # Aplicamos de nuevo la lógica por seguridad
        cantidad = self.cleaned_data.get("cantidad_presentacion") or Decimal("0.00")
        precio = self.cleaned_data.get("precio_unitario_aplicado") or Decimal("0.00")
        impuesto = self.cleaned_data.get("impuesto")

        instance.subtotal = cantidad * precio
        if impuesto:
            instance.porcentaje_impuesto_aplicado = impuesto.porcentaje

        if commit:
            instance.save()

        return instance

