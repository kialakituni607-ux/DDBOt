import { observer } from 'mobx-react-lite';
import './antipoverty-ai.scss';

const AntiPovertyAI = observer(() => {
    return (
        <div className='antipoverty-ai antipoverty-ai--coming-soon'>
            <div className='apai-coming-soon'>
                <div className='apai-coming-soon__icon'>🚧</div>
                <h1 className='apai-coming-soon__title'>Coming Soon</h1>
                <p className='apai-coming-soon__text'>
                    Antipoverty AI is on the way. Stay tuned — we&apos;ll let you know the moment it&apos;s ready.
                </p>
            </div>
        </div>
    );
});

export default AntiPovertyAI;
