import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Proofline 界面异常', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className={styles.page}>
        <div className={styles.panel}>
          <AlertTriangle aria-hidden="true" />
          <p className={styles.kicker}>界面恢复</p>
          <h1>这页暂时没能打开</h1>
          <p>本地数据没有被删除。重新载入后可继续学习。</p>
          <button className="button buttonPrimary" type="button" onClick={() => window.location.reload()}>
            <RotateCcw size={17} aria-hidden="true" />
            重新载入
          </button>
          <details>
            <summary>查看错误信息</summary>
            <code>{this.state.error.message}</code>
          </details>
        </div>
      </main>
    );
  }
}
