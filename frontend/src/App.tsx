import Home from './pages/Home';
import AutoRecordPromptWindow from './components/AutoRecordPromptWindow';

export default function App() {
  const windowName =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('window')
      : null;

  if (windowName === 'auto-record-prompt') {
    return <AutoRecordPromptWindow />;
  }

  return <Home />;
}
