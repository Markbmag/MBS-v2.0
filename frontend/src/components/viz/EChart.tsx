import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';
import { Box } from '@chakra-ui/react';
import type { EChartsOption } from 'echarts';
import { echarts } from '../../viz/echarts';

export interface EChartHandle {
  /** PNG data URL at 2x, on the chart's own surface colour. */
  png: (background: string) => string | null;
  /** An SVG document of the same chart (rendered offscreen with the SVG renderer). */
  svg: () => string | null;
}

interface EChartProps {
  option: EChartsOption;
  height?: string | number;
  chartRef?: Ref<EChartHandle>;
  ariaLabel?: string;
}

/** A thin wrapper: one ECharts instance per element, resized with its box, disposed on unmount. */
export function EChart({ option, height = '100%', chartRef, ariaLabel }: EChartProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = echarts.init(host.current, null, { renderer: 'canvas' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  useImperativeHandle(
    chartRef,
    () => ({
      png: (background: string) => chart.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: background }) ?? null,
      svg: () => {
        const el = host.current;
        if (!el) return null;
        const offscreen = echarts.init(null, null, { renderer: 'svg', ssr: true, width: el.clientWidth || 800, height: el.clientHeight || 400 });
        offscreen.setOption({ ...option, animation: false });
        const text = offscreen.renderToSVGString();
        offscreen.dispose();
        return text;
      },
    }),
    [option],
  );

  return <Box ref={host} h={height} w="100%" minH="160px" role="img" aria-label={ariaLabel} data-testid="echart" />;
}
