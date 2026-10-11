import { Figure } from "../Figure";
import { Box, DropShadowDef, Label } from "../primitives";

export interface DataFlowLabels {
  title: string;
  desc?: string;
  caption?: string;
  input: [string, string];
  loopBadge: string;
  passesInLoop: { num: string; name: string }[]; // the stages of one placement pass
  loopCondition: string;
  convergedLabel: string;
  backend: string;
  output: string;
}

// The placement pass's container and the stage boxes inside it.
const PASS_X = 148; // left edge of the container
const PASS_PAD = 14; // container padding at each side
const INNER_W = 72;
const INNER_GAP = 22; // between two stage boxes (a 20px arrow)
const ROW_Y = 80; // vertical center of the main pipeline row

export function DataFlow({ labels }: { labels: DataFlowLabels }) {
  const inner = labels.passesInLoop;
  const n = Math.max(1, inner.length);
  const innerX = (i: number) => PASS_X + PASS_PAD + i * (INNER_W + INNER_GAP);
  const passW = 2 * PASS_PAD + n * INNER_W + (n - 1) * INNER_GAP;
  const cx = PASS_X + passW / 2; // center of the container and of the exit chain
  const vbW = PASS_X + passW + 20;
  // Back from the last stage to the first: the pass run again with hints.
  const lastCx = innerX(n - 1) + INNER_W / 2;
  const firstCx = innerX(0) + INNER_W / 2;

  return (
    <Figure title={labels.title} desc={labels.desc} caption={labels.caption} viewBox={`0 0 ${vbW} 358`} maxWidth={vbW}>
      <defs>
        <marker id="dfArrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--svg-stroke)" />
        </marker>
        <marker id="dfArrowYellow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="var(--svg-yellow-stroke)" />
        </marker>
        <DropShadowDef id="dfShadow" />
      </defs>

      <style>{`
        .df-flow {
          fill: none;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-dasharray: 4 8;
          opacity: 0;
        }
        @media (prefers-reduced-motion: no-preference) {
          .df-flow {
            opacity: 0.85;
            animation: df-dash 3.2s linear infinite;
          }
          @keyframes df-dash {
            to { stroke-dashoffset: -24; }
          }
        }
      `}</style>

      {/* ── Input (data) ── */}
      <Box x={20} y={56} width={96} height={48} color="blue" filter="url(#dfShadow)" />
      <Label x={68} y={75} anchor="middle" size={10} bold color="blue">{labels.input[0]}</Label>
      <Label x={68} y={90} anchor="middle" size={10} bold color="blue">{labels.input[1]}</Label>

      <line x1={116} y1={ROW_Y} x2={PASS_X - 2} y2={ROW_Y} stroke="var(--svg-stroke)" strokeWidth={1.5} markerEnd="url(#dfArrow)" />

      {/* ── Placement pass container ── */}
      <rect x={PASS_X} y={28} width={passW} height={140} rx={8} fill="var(--svg-yellow-fill)" stroke="var(--svg-yellow-stroke)" strokeWidth={1.5} strokeDasharray="6 4" />
      <Label x={cx} y={46} anchor="middle" size={10} bold color="yellow">{labels.loopBadge}</Label>

      {/* The stages of the pass */}
      {inner.map((p, i) => {
        const x = innerX(i);
        const boxCx = x + INNER_W / 2;
        return (
          <g key={i}>
            <Box x={x} y={58} width={INNER_W} height={44} color="green" rx={6} filter="url(#dfShadow)" />
            <Label x={boxCx} y={75} anchor="middle" size={10} bold color="green">{p.num}</Label>
            <Label x={boxCx} y={91} anchor="middle" size={9} color="green">{p.name}</Label>
            {i < inner.length - 1 ? (
              <line x1={x + INNER_W} y1={ROW_Y} x2={x + INNER_W + 20} y2={ROW_Y} stroke="var(--svg-stroke)" strokeWidth={1.5} markerEnd="url(#dfArrow)" />
            ) : null}
          </g>
        );
      })}

      {/* Back to the first stage: the pass run again with hints */}
      <path d={`M ${lastCx} 102 L ${lastCx} 128 L ${firstCx} 128 L ${firstCx} 106`} fill="none" stroke="var(--svg-yellow-stroke)" strokeWidth={1.5} markerEnd="url(#dfArrowYellow)" />
      <Label x={cx} y={148} anchor="middle" size={9} color="yellow">{labels.loopCondition}</Label>

      {/* ── Exit chain: finished VDT → backend → output ── */}
      <line x1={cx} y1={168} x2={cx} y2={190} stroke="var(--svg-stroke)" strokeWidth={1.5} markerEnd="url(#dfArrow)" />

      <Box x={cx - 70} y={192} width={140} height={30} color="blue" filter="url(#dfShadow)" />
      <Label x={cx} y={211} anchor="middle" size={10} bold color="blue">{labels.convergedLabel}</Label>

      <line x1={cx} y1={222} x2={cx} y2={244} stroke="var(--svg-stroke)" strokeWidth={1.5} markerEnd="url(#dfArrow)" />

      <Box x={cx - 75} y={246} width={150} height={34} color="pink" filter="url(#dfShadow)" />
      <Label x={cx} y={267} anchor="middle" size={10} bold color="pink">{labels.backend}</Label>

      <line x1={cx} y1={280} x2={cx} y2={302} stroke="var(--svg-stroke)" strokeWidth={1.5} markerEnd="url(#dfArrow)" />

      <Box x={cx - 75} y={304} width={150} height={34} color="blue" filter="url(#dfShadow)" />
      <Label x={cx} y={326} anchor="middle" size={11} bold color="blue">{labels.output}</Label>

      {/* ── Animated flow overlays (hidden when reduced motion is preferred) ── */}
      <g aria-hidden="true">
        <path className="df-flow" stroke="var(--svg-blue-text)" d={`M 119 80 L ${PASS_X - 8} 80`} />
        {inner.slice(0, -1).map((_, i) => {
          const x = innerX(i) + INNER_W;
          return <path key={i} className="df-flow" stroke="var(--svg-blue-text)" d={`M ${x + 2} 80 L ${x + 14} 80`} />;
        })}
        <path className="df-flow" stroke="var(--svg-yellow-text)" d={`M ${lastCx} 104 L ${lastCx} 128 L ${firstCx} 128 L ${firstCx} 112`} />
        <path className="df-flow" stroke="var(--svg-blue-text)" d={`M ${cx} 171 L ${cx} 186`} />
        <path className="df-flow" stroke="var(--svg-blue-text)" d={`M ${cx} 225 L ${cx} 240`} />
        <path className="df-flow" stroke="var(--svg-blue-text)" d={`M ${cx} 283 L ${cx} 298`} />
      </g>
    </Figure>
  );
}
