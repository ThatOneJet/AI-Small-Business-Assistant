/**
 * JetCore Forge — a node/box canvas for planning ANY system visually (a PC build,
 * a workflow, a shipping route, a data pipeline, an architecture…).
 *
 * Each box has a TITLE + DESCRIPTION and lists of named INPUTS and OUTPUTS, each
 * with its own connection handle so you wire output→input. Notes are threaded to
 * the box they annotate: "Add note" enters a pick mode (cards march with dashed
 * ants) and the note you drop is tied to the chosen card by a dashed thread.
 *
 * The whole graph persists to the E2EE vault (forge.graph) and reloads. Built on
 * React Flow (@xyflow/react), styled to the existing JetCore look (custom card
 * nodes; amber accent inherited from the shell).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX
} from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeTypes
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './forge.css'
import { Button, Toggle } from '../../ui'
import { Icon } from '../../icons'
import type { JCScreenProps } from '../../contract'

/* ── data model (serializable) ────────────────────────────────────────────── */

type Port = { id: string; name: string }
type BoxData = { title: string; description: string; inputs: Port[]; outputs: Port[] }
type NoteData = { text: string }
type ForgeNode = Node<BoxData | NoteData>

interface ForgeGraph {
  nodes: Array<Pick<ForgeNode, 'id' | 'type' | 'position' | 'data'>>
  edges: Array<Pick<Edge, 'id' | 'source' | 'target' | 'sourceHandle' | 'targetHandle' | 'data'>>
}

const VAULT_KEY = 'forge.graph'

const FLOW_STYLE = { stroke: 'var(--accent)', strokeWidth: 2 }
const FLOW_MARKER = { type: MarkerType.ArrowClosed, color: 'var(--accent)' }
const THREAD_STYLE = { stroke: 'var(--text-3)', strokeWidth: 1.5, strokeDasharray: '5 4' }

function newId(prefix: string): string {
  try {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
  } catch {
    return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
  }
}
function port(name: string): Port {
  return { id: newId('p'), name }
}

/** Re-apply edge styling from its kind (flow vs note thread) after a reload. */
function hydrateEdge(e: ForgeGraph['edges'][number]): Edge {
  const kind = (e.data as { kind?: string } | null | undefined)?.kind
  if (kind === 'thread') {
    return { ...e, animated: true, style: THREAD_STYLE, data: { kind: 'thread' } }
  }
  return { ...e, style: FLOW_STYLE, markerEnd: FLOW_MARKER }
}

/** Tolerate graphs saved before inputs/outputs existed. */
function hydrateNode(n: ForgeGraph['nodes'][number]): ForgeNode {
  if (n.type === 'box') {
    const d = (n.data ?? {}) as Partial<BoxData>
    return {
      ...n,
      dragHandle: '.jc-forge-grip',
      data: {
        title: d.title ?? '',
        description: d.description ?? '',
        inputs: Array.isArray(d.inputs) ? d.inputs : [],
        outputs: Array.isArray(d.outputs) ? d.outputs : []
      }
    } as ForgeNode
  }
  return n as ForgeNode
}

function serialize(nodes: ForgeNode[], edges: Edge[]): string {
  const slimNodes = nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))
  const slimEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
    data: e.data ?? null
  }))
  return JSON.stringify({ nodes: slimNodes, edges: slimEdges })
}

/* ── canvas-wide note-attach mode (so box nodes can react to it) ───────────── */

interface ForgeCtx {
  noting: boolean
  pickNoteTarget: (boxId: string) => void
}
const ForgeContext = createContext<ForgeCtx>({ noting: false, pickNoteTarget: () => {} })

/* ── custom nodes (JetCore cards) ─────────────────────────────────────────── */

function BoxNode({ id, data, selected }: NodeProps): JSX.Element {
  const { setNodes } = useReactFlow()
  const { noting, pickNoteTarget } = useContext(ForgeContext)
  const d = data as BoxData

  const patch = useCallback(
    (p: Partial<BoxData>): void => {
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)))
    },
    [id, setNodes]
  )
  const renamePort = (kind: 'inputs' | 'outputs', pid: string, name: string): void =>
    patch({ [kind]: d[kind].map((p) => (p.id === pid ? { ...p, name } : p)) } as Partial<BoxData>)
  const addPort = (kind: 'inputs' | 'outputs'): void =>
    patch({ [kind]: [...d[kind], port(kind === 'inputs' ? 'Input' : 'Output')] } as Partial<BoxData>)
  const removePort = (kind: 'inputs' | 'outputs', pid: string): void =>
    patch({ [kind]: d[kind].filter((p) => p.id !== pid) } as Partial<BoxData>)

  const portRow = (kind: 'inputs' | 'outputs', p: Port): JSX.Element => {
    const isIn = kind === 'inputs'
    return (
      <div
        key={p.id}
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 14px'
        }}
      >
        <Handle
          type={isIn ? 'target' : 'source'}
          position={isIn ? Position.Left : Position.Right}
          id={`${isIn ? 'in' : 'out'}:${p.id}`}
          className="jc-forge-handle"
          style={isIn ? { left: -6, right: 'auto', top: '50%' } : { right: -6, left: 'auto', top: '50%' }}
        />
        <input
          className="nodrag"
          value={p.name}
          placeholder={isIn ? 'input' : 'output'}
          onChange={(e) => renamePort(kind, p.id, e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-2)',
            fontSize: 12.5,
            padding: 0,
            textAlign: isIn ? 'left' : 'right'
          }}
        />
        <button
          className="nodrag jc-forge-x"
          onClick={() => removePort(kind, p.id)}
          title={`Remove ${isIn ? 'input' : 'output'}`}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="jc-forge-box"
      onClick={() => {
        if (noting) pickNoteTarget(id)
      }}
      style={{
        width: 256,
        background: 'var(--surface)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--r-md)',
        boxShadow: selected
          ? '0 0 0 3px var(--accent-soft), 0 14px 30px -18px hsl(var(--shadow-c) / .7)'
          : '0 14px 30px -20px hsl(var(--shadow-c) / .6)',
        cursor: noting ? 'crosshair' : 'default'
      }}
    >
      {/* note-thread anchor */}
      <Handle type="target" id="note" position={Position.Top} className="jc-forge-note-handle" />

      {/* drag grip — the unambiguous "move me" area */}
      <div className="jc-forge-grip" title="Drag to move">
        <Icon name="dots" size={14} />
      </div>

      <div style={{ padding: '12px 14px 11px' }}>
        <input
          className="nodrag"
          value={d.title}
          placeholder="Untitled"
          onChange={(e) => patch({ title: e.target.value })}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text)',
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            padding: 0,
            marginBottom: 5
          }}
        />
        <textarea
          className="nodrag nowheel"
          value={d.description}
          placeholder="Describe this step…"
          rows={Math.min(6, Math.max(2, d.description.split('\n').length))}
          onChange={(e) => patch({ description: e.target.value })}
          style={{
            width: '100%',
            resize: 'none',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--text-2)',
            fontSize: 14,
            lineHeight: 1.45,
            padding: 0,
            fontFamily: 'inherit'
          }}
        />
      </div>

      {d.inputs.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Section label="Inputs" onAdd={() => addPort('inputs')}>
            {d.inputs.map((p) => portRow('inputs', p))}
          </Section>
        </div>
      )}
      {d.outputs.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <Section label="Outputs" onAdd={() => addPort('outputs')}>
            {d.outputs.map((p) => portRow('outputs', p))}
          </Section>
        </div>
      )}
      {(d.inputs.length === 0 || d.outputs.length === 0) && (
        <div style={{ borderTop: '1px solid var(--border)', display: 'flex', gap: 8, padding: '8px 14px' }}>
          {d.inputs.length === 0 && (
            <button className="nodrag jc-forge-footadd" onClick={() => addPort('inputs')}>
              <Icon name="plus" size={10} /> Input
            </button>
          )}
          {d.outputs.length === 0 && (
            <button className="nodrag jc-forge-footadd" onClick={() => addPort('outputs')}>
              <Icon name="plus" size={10} /> Output
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ label, onAdd, children }: { label: string; onAdd: () => void; children: JSX.Element[] }): JSX.Element {
  return (
    <div style={{ padding: '7px 0 8px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          marginBottom: 2
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
          {label}
        </span>
        <button className="nodrag jc-forge-add" onClick={onAdd} title={`Add ${label.slice(0, -1).toLowerCase()}`}>
          <Icon name="plus" size={11} />
        </button>
      </div>
      {children}
    </div>
  )
}

function NoteNode({ id, data, selected }: NodeProps): JSX.Element {
  const { setNodes } = useReactFlow()
  const d = data as NoteData
  return (
    <div
      style={{
        width: 204,
        background: 'color-mix(in oklch, var(--accent) 18%, var(--surface))',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--accent-line)'}`,
        borderRadius: 'var(--r-sm)',
        boxShadow: '0 10px 24px -18px hsl(var(--shadow-c) / .6)',
        padding: '9px 11px'
      }}
    >
      <Handle type="source" id="note" position={Position.Bottom} className="jc-forge-note-handle" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, color: 'var(--accent-h)' }}>
        <Icon name="flag" size={12} />
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Note</span>
      </div>
      <textarea
        className="nodrag nowheel"
        value={d.text}
        placeholder="Jot a note…"
        rows={Math.min(8, Math.max(2, d.text.split('\n').length))}
        onChange={(e) =>
          setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, text: e.target.value } } : n)))
        }
        style={{
          width: '100%',
          resize: 'none',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text)',
          fontSize: 13,
          lineHeight: 1.45,
          padding: 0,
          fontFamily: 'inherit'
        }}
      />
    </div>
  )
}

/* ── the canvas ───────────────────────────────────────────────────────────── */

function Flow(): JSX.Element {
  const nodeTypes = useMemo<NodeTypes>(() => ({ box: BoxNode, note: NoteNode }), [])
  const [nodes, setNodes, onNodesChange] = useNodesState<ForgeNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(true)
  const [noting, setNoting] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [wantIn, setWantIn] = useState(true)
  const [wantOut, setWantOut] = useState(true)
  const { screenToFlowPosition } = useReactFlow()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load once on mount (hydrating older graphs + edge styles).
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const raw = await window.decks?.vault?.get(VAULT_KEY)
        if (alive && raw) {
          const g = JSON.parse(raw) as ForgeGraph
          if (Array.isArray(g.nodes)) setNodes(g.nodes.map(hydrateNode))
          if (Array.isArray(g.edges)) setEdges(g.edges.map(hydrateEdge))
        }
      } catch {
        /* fresh canvas */
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [setNodes, setEdges])

  // Debounced autosave.
  useEffect(() => {
    if (!loaded) return
    setSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void window.decks?.vault
        ?.set({ key: VAULT_KEY, plaintext: serialize(nodes, edges) })
        .then(() => setSaved(true))
        .catch(() => setSaved(false))
    }, 600)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [nodes, edges, loaded])

  // Esc cancels note-attach mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setNoting(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge({ ...c, style: FLOW_STYLE, markerEnd: FLOW_MARKER }, eds)),
    [setEdges]
  )

  const spawnPos = useCallback((): { x: number; y: number } => {
    try {
      return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    } catch {
      return { x: 120, y: 120 }
    }
  }, [screenToFlowPosition])

  const createBox = useCallback(
    (withIn: boolean, withOut: boolean) => {
      const p = spawnPos()
      setNodes((nds) =>
        nds.concat({
          id: newId('box'),
          type: 'box',
          dragHandle: '.jc-forge-grip',
          position: { x: p.x + (Math.random() * 60 - 30), y: p.y + (Math.random() * 60 - 30) },
          data: {
            title: '',
            description: '',
            inputs: withIn ? [port('Input')] : [],
            outputs: withOut ? [port('Output')] : []
          }
        })
      )
    },
    [setNodes, spawnPos]
  )

  // "Add note": if there are boxes, enter pick mode (cards march); else drop a free note.
  const addNote = useCallback(() => {
    if (nodes.some((n) => n.type === 'box')) {
      setNoting(true)
    } else {
      const p = spawnPos()
      setNodes((nds) => nds.concat({ id: newId('note'), type: 'note', position: p, data: { text: '' } }))
    }
  }, [nodes, setNodes, spawnPos])

  // Attach a fresh note to the chosen box, tied by a dashed thread.
  const pickNoteTarget = useCallback(
    (boxId: string) => {
      const noteId = newId('note')
      setNodes((nds) => {
        const box = nds.find((n) => n.id === boxId)
        const pos = box ? { x: box.position.x + 24, y: box.position.y + 230 } : { x: 140, y: 140 }
        return nds.concat({ id: noteId, type: 'note', position: pos, data: { text: '' } })
      })
      setEdges((eds) =>
        eds.concat({
          id: newId('thread'),
          source: noteId,
          sourceHandle: 'note',
          target: boxId,
          targetHandle: 'note',
          animated: true,
          style: THREAD_STYLE,
          data: { kind: 'thread' }
        })
      )
      setNoting(false)
    },
    [setNodes, setEdges]
  )

  return (
    <ForgeContext.Provider value={{ noting, pickNoteTarget }}>
      <ReactFlow
        className={noting ? 'jc-forge-pick' : undefined}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        colorMode="dark"
        fitView
        deleteKeyCode={['Delete', 'Backspace']}
        defaultEdgeOptions={{ style: FLOW_STYLE, markerEnd: FLOW_MARKER }}
        connectionLineStyle={FLOW_STYLE}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'var(--bg)' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color="var(--border-2)" />
        <Controls showInteractive={false} />
        <Panel position="top-left">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button variant={addOpen ? 'primary' : 'soft'} size="sm" icon="plus" onClick={() => setAddOpen((v) => !v)}>
              Add box
            </Button>
            <Button variant={noting ? 'primary' : 'surface'} size="sm" icon="flag" onClick={addNote}>
              {noting ? 'Pick a box…' : 'Add note'}
            </Button>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--text-3)', marginLeft: 4 }}>
              <Icon name={saved ? 'check' : 'refresh'} size={12} />
              {saved ? 'Saved' : 'Saving…'}
            </span>
          </div>
          {addOpen && (
            <div
              style={{
                marginTop: 8,
                width: 230,
                padding: 14,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                boxShadow: '0 18px 44px -22px hsl(var(--shadow-c) / .65)'
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: '-0.01em', marginBottom: 10 }}>New box</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0' }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Start with an input</span>
                <Toggle checked={wantIn} onChange={setWantIn} size={0.82} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '5px 0' }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Start with an output</span>
                <Toggle checked={wantOut} onChange={setWantOut} size={0.82} />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button
                  variant="primary"
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    createBox(wantIn, wantOut)
                    setAddOpen(false)
                  }}
                >
                  Create box
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Panel>
        {noting && (
          <Panel position="top-center">
            <div
              style={{
                marginTop: 8,
                padding: '7px 13px',
                borderRadius: 999,
                background: 'var(--accent-soft)',
                color: 'var(--accent-h)',
                border: '1px solid var(--accent-line)',
                fontSize: 12.5,
                fontWeight: 600,
                boxShadow: '0 10px 24px -16px hsl(var(--shadow-c) / .6)'
              }}
            >
              Click a box to attach your note · Esc to cancel
            </div>
          </Panel>
        )}
        {loaded && nodes.length === 0 && (
          <Panel position="top-center">
            <div style={{ marginTop: 80, textAlign: 'center', color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6, pointerEvents: 'none' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-2)', marginBottom: 4 }}>Plan anything here</div>
              Add a box, name its inputs &amp; outputs, then drag an output to the next box&rsquo;s input.
              <br />
              Use notes to annotate a box. It saves to your vault automatically.
            </div>
          </Panel>
        )}
      </ReactFlow>
    </ForgeContext.Provider>
  )
}

export function ForgeScreen(props: JCScreenProps): JSX.Element {
  void props
  return (
    <div style={{ height: '100%', minHeight: 0 }}>
      <ReactFlowProvider>
        <Flow />
      </ReactFlowProvider>
    </div>
  )
}
