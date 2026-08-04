# Generated manually for precision migration to 4 decimals
from django.db import migrations, models
import django.db.models.deletion
from decimal import Decimal


class Migration(migrations.Migration):
    """
    Migra campos de cantidad, costo, stock, factor y precio unitario
    de 2 a 4 decimales para soportar mayor precisión.
    """

    # >>> AJUSTA ESTA DEPENDENCIA: pon el nombre de tu última migración de nucleo <<<
    dependencies = [
        ('nucleo', '0001_initial'),  # REEMPLAZA '0001_initial' por tu última migración
    ]

    operations = [
        # Producto
        migrations.AlterField(
            model_name='producto',
            name='costo_base_moneda_principal',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=15),
        ),
        migrations.AlterField(
            model_name='producto',
            name='stock_inicial',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=15),
        ),
        # PresentacionProducto
        migrations.AlterField(
            model_name='presentacionproducto',
            name='factor_conversion',
            field=models.DecimalField(decimal_places=4, default=Decimal('1.0000'), max_digits=10),
        ),
        migrations.AlterField(
            model_name='presentacionproducto',
            name='precio_venta_principal',
            field=models.DecimalField(decimal_places=4, max_digits=15),
        ),
        # InventarioAlmacen
        migrations.AlterField(
            model_name='inventarioalmacen',
            name='stock_actual_unidades_base',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=15),
        ),
        # DetalleVenta
        migrations.AlterField(
            model_name='detalleventa',
            name='cantidad_presentacion',
            field=models.DecimalField(decimal_places=4, max_digits=15),
        ),
        migrations.AlterField(
            model_name='detalleventa',
            name='precio_unitario_aplicado',
            field=models.DecimalField(decimal_places=4, max_digits=15),
        ),
        # DetalleCompra
        migrations.AlterField(
            model_name='detallecompra',
            name='cantidad_presentacion',
            field=models.DecimalField(decimal_places=4, max_digits=15),
        ),
        migrations.AlterField(
            model_name='detallecompra',
            name='precio_unitario_aplicado',
            field=models.DecimalField(decimal_places=4, max_digits=15),
        ),
        # DetalleEgresoInventario
        migrations.AlterField(
            model_name='detalleegresoinventario',
            name='cantidad',
            field=models.DecimalField(decimal_places=4, max_digits=15),
        ),
        # RutaMercadoDetalle
        migrations.AlterField(
            model_name='rutamercadodetalle',
            name='cantidad_salida',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=15),
        ),
        migrations.AlterField(
            model_name='rutamercadodetalle',
            name='cantidad_entrada',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=15),
        ),
        migrations.AlterField(
            model_name='rutamercadodetalle',
            name='precio_venta_bs',
            field=models.DecimalField(decimal_places=4, default=Decimal('0.0000'), max_digits=15),
        ),
    ]
