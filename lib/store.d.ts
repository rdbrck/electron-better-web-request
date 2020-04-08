import { Session } from 'electron';
declare const enhanceWebRequest: (session: Session) => Session;
export default enhanceWebRequest;
