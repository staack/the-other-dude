import { LineChart, Line } from 'recharts'

interface SparklineProps {
  data: number[]
  color?: string
  width?: number
  height?: number
}

export function Sparkline({ data, color = '#38BDF8', width = 60, height = 24 }: SparklineProps) {
  const chartData = data.map((v, i) => ({ v, i }))
  return (
    <LineChart width={width} height={height} data={chartData}>
      <Line
        type="monotone"
        dataKey="v"
        stroke={color}
        dot={false}
        strokeWidth={1.5}
        isAnimationActive={false}
      />
    </LineChart>
  )
}
