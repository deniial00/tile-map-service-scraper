import React from 'react';
import Map from '../components/Map';

const MapView: React.FC = () => {
    return (
        <div className="py-6">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <h1 className="text-3xl font-bold leading-tight tracking-tight text-gray-900">
                    Map View
                </h1>
                <div className="mt-8">
                    <div className="bg-white rounded-lg shadow p-4">
                        <Map />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MapView; 