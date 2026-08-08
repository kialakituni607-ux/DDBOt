import { Localize } from '@deriv-com/translations';
import './admin-panel.scss';

const AdminPanel = () => {
    return (
        <div className='admin-panel'>
            <h2>
                <Localize i18n_default_text='Admin' />
            </h2>
            <p>
                <Localize i18n_default_text='Admin features coming soon.' />
            </p>
        </div>
    );
};

export default AdminPanel;
