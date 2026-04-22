import ChangeTheme from './ChangeTheme';
import Endpoint from './Endpoint';
import FullScreen from './FullScreen';
import NetworkStatus from './NetworkStatus';
import ServerTime from './ServerTime';
import './footer.scss';

const Footer = () => {
    return (
        <footer className='app-footer'>
            <FullScreen />
            <div className='app-footer__vertical-line' />
            <ChangeTheme />
            <div className='app-footer__vertical-line' />
            <ServerTime />
            <div className='app-footer__vertical-line' />
            <NetworkStatus />
            <Endpoint />
        </footer>
    );
};

export default Footer;
