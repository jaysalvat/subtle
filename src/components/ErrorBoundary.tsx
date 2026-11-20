/**
 * A rendering error anywhere shows this instead of a black screen: what happened, Close this
 * project (it stays in Projects, the app starts empty), or Reload. Nothing is lost.
 */
import { Component, type ReactNode } from 'react';
import { t } from '../i18n';
import { newProject } from '../store/projects';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>{t.crash.title}</h1>
        <p>{t.crash.text}</p>
        <pre className="crash-detail">{error.message}</pre>
        <div className="crash-actions">
          <button className="btn" onClick={() => location.reload()}>
            {t.crash.reload}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              await newProject().catch(() => {});
              this.setState({ error: null });
            }}
          >
            {t.crash.close}
          </button>
        </div>
      </div>
    );
  }
}
