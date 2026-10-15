import './styles.css';
import { createApp } from './app/create-app';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('App root was not found.');
}

const app = createApp(root);

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
