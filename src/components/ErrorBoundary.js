import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

// When one page throws, keep the rest of the back office.
//
// React's rule is unforgiving and worth stating plainly: an error thrown
// during render, with nothing to catch it, unmounts the **entire** tree. Not
// the component that threw — everything. The sidebar, the header, the page you
// could have navigated to instead. The screen goes white and stays white, and
// from the outside the whole back office looks dead.
//
// That is what happened here: one missing import in Order Analysis, and the
// report was "the whole screen goes blank", because it was. A single page
// being broken should read as a single page being broken.
//
// Has to be a class component. There is still no hook equivalent of
// componentDidCatch — this is the one place React has not moved on.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null, showDetail: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Straight to the console as well. The message below is written for
    // whoever is standing at the till; the stack is for whoever is fixing it,
    // and it needs to survive them clicking away from this screen.
    console.error('[page crashed]', this.props.name || 'unknown page', error, info?.componentStack)
  }

  // Navigating to another page must clear the error. Without this the boundary
  // stays in its error state for the rest of the session — every page after
  // the broken one would show this screen, which looks exactly like the whole
  // app being broken and is the bug this component exists to prevent.
  //
  // App.js also passes key={page}, which remounts it. This is the belt to that
  // pair of braces: if the key is ever removed, this still works.
  componentDidUpdate(prev) {
    if (prev.name !== this.props.name && this.state.error) {
      this.setState({ error: null, info: null, showDetail: false })
    }
  }

  render() {
    const { error, info, showDetail } = this.state
    if (!error) return this.props.children

    const where = this.props.name || 'This page'

    return (
      <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
        <div style={{
          background: '#fff', border: '1px solid #f0c6c0', borderLeft: '4px solid #c0392b',
          borderRadius: 12, padding: 24,
        }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <AlertTriangle size={22} style={{ color: '#c0392b', flex: 'none', marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: '0 0 6px', fontSize: 18 }}>{where} could not be shown</h2>
              <p style={{ margin: '0 0 4px', color: '#555', fontSize: 14, lineHeight: 1.55 }}>
                Something in this page threw an error, so it stopped rather than
                showing you numbers it could not stand behind.
              </p>
              {/* The reassurance that matters most, and it is true: a render
                  error cannot have written anything. */}
              <p style={{ margin: '0 0 16px', color: '#555', fontSize: 14, lineHeight: 1.55 }}>
                <strong>Nothing has been saved or changed.</strong> The rest of the
                back office is still working — use the menu on the left.
              </p>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={() => this.setState({ error: null, info: null, showDetail: false })}
                  style={btn}
                >
                  <RefreshCw size={15} /> Try again
                </button>
                <button
                  onClick={() => window.dispatchEvent(new CustomEvent('bnj-navigate', { detail: 'dashboard' }))}
                  style={{ ...btn, background: '#fff', color: '#333', border: '1px solid #ddd' }}
                >
                  <Home size={15} /> Dashboard
                </button>
                <button
                  onClick={() => this.setState(s => ({ showDetail: !s.showDetail }))}
                  style={{ ...btn, background: 'none', color: '#777', border: 'none', paddingInline: 8 }}
                >
                  {showDetail ? 'Hide' : 'Show'} the technical detail
                </button>
              </div>

              {showDetail && (
                <pre style={{
                  marginTop: 14, padding: 12, background: '#faf7f7', border: '1px solid #eee',
                  borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 280, overflow: 'auto', color: '#7a2e22',
                }}>
                  {String(error && (error.stack || error.message || error))}
                  {info?.componentStack || ''}
                </pre>
              )}

              <p style={{ margin: '14px 0 0', color: '#888', fontSize: 12 }}>
                If this keeps happening, send whoever maintains this the text
                above — it names the exact line.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

const btn = {
  display: 'inline-flex', alignItems: 'center', gap: 7,
  padding: '9px 15px', borderRadius: 9, border: '1px solid transparent',
  background: '#c0392b', color: '#fff',
  font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
}
