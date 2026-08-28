import { useEffect } from 'react';
import { MapView } from './map/MapView';
import { startLiveConnection } from './api/liveConnection';

function App() {
  useEffect(() => startLiveConnection(), []);

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <MapView />
    </div>
  );
}

export default App;
