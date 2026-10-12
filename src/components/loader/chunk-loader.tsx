import './chunk-loader.scss';

export default function ChunkLoader({ message }: { message: string }) {
    return (
        <div className='tm-loader'>
            <div className='tm-loader__card'>
                <img className='tm-loader__logo' src='/trademasters-logo.png' alt='TradeMasters' />
                <div className='tm-loader__name'>TRADEMASTERS</div>
                <div className='tm-loader__sub'>Trading Workspace</div>
                <div className='tm-loader__msg'>{message}</div>
                <div className='tm-loader__bar' />
            </div>
        </div>
    );
}
