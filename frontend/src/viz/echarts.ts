/** ECharts, tree-shaken: only the chart types and components Ncode uses (smaller bundle). */
import { BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart, ScatterChart, GaugeChart, HeatmapChart, FunnelChart,
  GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, VisualMapComponent,
  LabelLayout, CanvasRenderer, SVGRenderer,
]);

export { echarts };
