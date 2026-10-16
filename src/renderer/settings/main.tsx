import { createRoot } from 'react-dom/client';
import { warmFx } from '../shared/emoteFx';
import { App } from './App';
import './settings.css';
import './mac.css';
import '../shared/emoteFx.css';

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
warmFx(); // the effect picker's first open doesn't get to pay for the sprites' first paint
