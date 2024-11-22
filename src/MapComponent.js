//mapcomponent.js

import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import areaJson from './seoul80_place.json';

mapboxgl.accessToken = 'pk.eyJ1Ijoia2diNDg1NCIsImEiOiJjbTJ1NDlmZ2YwOWljMmtvaWltZjFlZXdkIn0.aLnwIt7wXc7ir6vjkogdnQ';

const Mapcomponent = () => {
  const mapContainer = useRef(null);
  const [selectedAreaData, setSelectedAreaData] = useState(null);
  const [commercialData, setCommercialData] = useState({});
  const [map, setMap] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [updateTime, setUpdateTime] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false); // 패널 열림 상태 관리
  const [isFullScreen, setIsFullScreen] = useState(false); // 전체 화면 상태 관리
  const [parsedData, setParsedData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState(null);

  const fetchPopulationAndCommercialData = async () => {
    setIsLoading(true);
    const commercialActivityData = {};

    const requests = areaJson.features.map((area) => {
      const url = `http://openapi.seoul.go.kr:8088/71516965496b6f6f3636515a765047/xml/citydata_cmrcl/1/5/${encodeURIComponent(area.properties.AREA_NM)}`;

      return fetch(url)
        .then((response) => response.text())
        .then((data) => {
          const parser = new DOMParser();
          const xml = parser.parseFromString(data, 'application/xml');
          const areaName = xml.getElementsByTagName('AREA_NM')[0]?.textContent;
          const commercialLevel = xml.getElementsByTagName('AREA_CMRCL_LVL')[0]?.textContent;
          const paymentCount = xml.getElementsByTagName('AREA_SH_PAYMENT_CNT')[0]?.textContent;
          const paymentMin = xml.getElementsByTagName('AREA_SH_PAYMENT_AMT_MIN')[0]?.textContent;
          const paymentMax = xml.getElementsByTagName('AREA_SH_PAYMENT_AMT_MAX')[0]?.textContent;
          const areas = xml.getElementsByTagName('CMRCL_RSB');
          const parsedCommercialAreas = Array.from(areas).map((area) => ({
            largeCategory: area.getElementsByTagName('RSB_LRG_CTGR')[0]?.textContent || 'N/A',
            midCategory: area.getElementsByTagName('RSB_MID_CTGR')[0]?.textContent || 'N/A',
            shopPaymentCount: parseInt(area.getElementsByTagName('RSB_SH_PAYMENT_CNT')[0]?.textContent) || 0,
          }));

          commercialActivityData[areaName] = {
            commercialLevel: commercialLevel || 'N/A',
            paymentCount: parseInt(paymentCount) || 0,
            paymentMin: parseInt(paymentMin) || 0,
            paymentMax: parseInt(paymentMax) || 0,
            detailedCategories: parsedCommercialAreas,
          };
        })
        .catch((error) => {
          console.error(`Error fetching data for ${area.properties.AREA_NM}:`, error);
        });
    });

    await Promise.all(requests);
    console.log("Finished fetching population data:", commercialActivityData);
    setCommercialData(commercialActivityData);
    setIsLoading(false);
  };

  useEffect(() => {
    if (!map) {
      const initializeMap = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/kgb4854/cm2xeuvps002q01oj8wpfham3',
        center: [126.978, 37.5665],
        zoom: 11,
        language: 'ko'
      });

      initializeMap.on('load', () => {
        setMap(initializeMap);
      });

      return () => {
        if (map) map.remove();
      };
    }
  }, [map]);

  useEffect(() => {
    if (!map) return;
    fetchPopulationAndCommercialData();

    const interval = setInterval(fetchPopulationAndCommercialData, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [map]);

  useEffect(() => {
    if (!map || Object.keys(commercialData).length === 0) return;


    const polygonData = {
      type: 'FeatureCollection',
      features: areaJson.features
        .map((area) => {
          const commData = commercialData[area.properties.AREA_NM];
          if (!commData) return null;

          return {
            type: 'Feature',
            geometry: area.geometry,
            properties: {
              parsedData: parsedData.find((data) => data.areaName === area.properties.AREA_NM),
              AREA_NM: area.properties.AREA_NM,
              commercialLevel: commData.commercialLevel,
              paymentCount: commData.paymentCount,
              paymentMin: commData.paymentMin,
              paymentMax: commData.paymentMax,
              detailedCategories: commData.detailedCategories,

            },
          };
        })
        .filter(Boolean),
    };

    if (map.getSource('populationDensity')) {
      map.getSource('populationDensity').setData(polygonData);
    } else {
      map.addSource('populationDensity', {
        type: 'geojson',
        data: polygonData
      });

      map.addLayer({
        id: 'population-polygon',
        type: 'fill-extrusion',
        source: 'populationDensity',
        paint: {
          'fill-extrusion-color': [
            'match',
            ['get', 'commercialLevel'],
            '바쁜', 'red',      // '바쁜'은 빨간색
            '분주한', 'orange', // '분주한'은 오렌지색
            '보통', 'yellow',   // '보통'은 노란색
            '한산한', 'green',  // '한산한'은 초록색
            'gray',             // 그 외는 회색
          ],
          'fill-extrusion-height': [
            'match',
            ['get', 'congestionLevel'],
            '한산한', 30,            // 'Low' - 30m
            '보통', 60,         // 'Medium' - 60m
            '분주한', 90,     // 'MediumHigh' - 90m
            '바쁜', 120,          // 'High' - 120m
            50,                   // 기본 높이 (혼잡도가 없거나 다른 값일 경우)
          ],
          'fill-extrusion-opacity': 0.5,
        },
      });
    }

    // 구역 클릭 이벤트
    map.on('click', 'population-polygon', (e) => {
      const properties = e.features[0].properties;

      // 색깔이 칠해진 구역인지 확인 (예: commercialLevel 유무 확인)
      if (properties.commercialLevel) {

        setSelectedAreaData({
          AREA_NM: properties.AREA_NM,
          commercialLevel: properties.commercialLevel,
          paymentCount: properties.paymentCount,
          paymentMin: properties.paymentMin,
          paymentMax: properties.paymentMax,
          additionalData: properties.parsedData,

        });
        setIsPanelOpen(true); // 패널 열기
      } else {
        setSelectedAreaData(null);
        setIsPanelOpen(false); // 패널 닫기
      }
    });

    // 지도 전체 클릭 이벤트 (구역 외부 클릭 처리)
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['population-polygon'] });

      if (features.length === 0) {
        setSelectedAreaData(null);
        setIsPanelOpen(false); // 패널 닫기
      }
    });
  }, [map, commercialData]);

  // 슬라이드 업 패널 스타일
  const panelStyle = {
    position: 'fixed',
    bottom: isFullScreen ? '0' : '0', // 전체 화면 모드에서는 하단 고정
    left: 0,
    right: 0,
    height: isFullScreen ? '95vh' : '30vh', // 전체 화면일 경우 화면을 다 덮게 설정
    backgroundColor: 'white',
    transition: 'height 0.3s ease-in-out',
    zIndex: 1000,
    overflowY: 'auto',
    padding: '20px',
    borderRadius: isFullScreen ? '20px 20px 0 0' : '20px 20px 0 0', // 모서리를 둥글게 설정
  };

  const toggleFullScreen = () => {
    setIsFullScreen((prev) => !prev);
  };

  const loadingScreenStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100%',
    height: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    fontSize: '1.5rem',
    color: '#333',
    zIndex: 1000,
  };

  const handleSearch = () => {
    const trimmedSearchTerm = searchTerm.trim();
  
    const areaData = areaJson.features.find(
      feature => feature.properties.AREA_NM === trimmedSearchTerm
    );
  
    if (areaData) {
      if (areaData.geometry.type === 'Polygon') {
        const [lng, lat] = areaData.geometry.coordinates[0][0];
        map.flyTo({
          center: [lng, lat],
          zoom: 14,
          essential: true,
        });
      } else {
        setSearchError(`"${trimmedSearchTerm}"의 좌표를 찾을 수 없습니다.`);
        return;
      }
  
      setSearchError(null);
    } else {
      setSearchError(`"${trimmedSearchTerm}"에 해당하는 구역을 찾을 수 없습니다.`);
    }
  };
  


  return (
    <div style={{ position: 'relative' }}>
      {isLoading && <div style={loadingScreenStyle}>Loading data...</div>}
      <div ref={mapContainer} style={{ height: '100vh' }} />
      {/* 검색 입력창 */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'white',
          padding: '10px',
          borderRadius: '5px',
          boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
          zIndex: 1000,
        }}
      >
        <input
          type="text"
          value={searchTerm}
          placeholder="구역 이름을 입력하세요"
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            padding: '8px',
            width: '200px',
            borderRadius: '5px',
            border: '1px solid #ccc',
          }}
        />
        <button
          onClick={handleSearch}
          style={{
            marginLeft: '10px',
            padding: '8px 12px',
            backgroundColor: 'blue',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
          }}
        >
          검색
        </button>
      </div>

      {/* 에러 메시지 */}
      {searchError && (
        <div
          style={{
            position: 'absolute',
            top: '80px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#ffcccc',
            padding: '10px',
            borderRadius: '5px',
            boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
            zIndex: 1000,
            color: 'red',
          }}
        >
          {searchError}
        </div>
      )}

      {isPanelOpen && selectedAreaData && (
        <div>
          <button
            onClick={toggleFullScreen}
            style={{
              position: 'absolute',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 20px',
              backgroundColor: 'blue',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              zIndex: 2000,
            }}
          >
            {isFullScreen ? '축소' : '전체 화면'}
          </button>

          <div style={panelStyle}>
            <h3>{selectedAreaData.AREA_NM}</h3>
            <p>상업 활동 수준: {selectedAreaData.commercialLevel}</p>
            <p>결제 건수: {selectedAreaData.paymentCount}</p>
            <p>최소 결제액: {selectedAreaData.paymentMin.toLocaleString()}원</p>
            <p>최대 결제액: {selectedAreaData.paymentMax.toLocaleString()}원</p>

            {/* groupedData 시각화 */}
            <div style={{ marginTop: '20px' }}>
              <h4>지역별 상업 활동</h4>
              {commercialData[selectedAreaData?.AREA_NM]?.detailedCategories?.length > 0 ? (
                commercialData[selectedAreaData?.AREA_NM]?.detailedCategories.reduce((acc, item) => {
                  // largeCategory 기준으로 그룹화
                  const existingCategory = acc.find(category => category.largeCategory === item.largeCategory);
                  if (existingCategory) {
                    // 중복된 midCategory를 제외
                    const isDuplicate = existingCategory.midCategories.some(
                      midItem => midItem.midCategory === item.midCategory
                    );
                    if (!isDuplicate) {
                      existingCategory.midCategories.push(item);
                    }
                  } else {
                    acc.push({
                      largeCategory: item.largeCategory, // 대분류 추가
                      midCategories: [item], // 중분류 배열 초기화
                    });
                  }
                  return acc;
                }, []).map(({ largeCategory, midCategories }) => (
                  <div key={largeCategory} style={{ marginBottom: '15px' }}>
                    <h5>대분류: {largeCategory}</h5>
                    {midCategories.map((item, index) => (
                      <p key={index} style={{ margin: '5px 0', fontSize: '14px' }}>
                        중분류: {item.midCategory}, 결제 건수: {item.shopPaymentCount}
                      </p>
                    ))}
                  </div>
                ))
              ) : (
                <p>상업 활동 데이터가 없습니다.</p>
              )}
            </div>


            {/* 디버깅용 콘솔 로그 */}
            {console.log('Selected Area Data:', selectedAreaData)}
            {console.log('Selected Area Categories:', commercialData[selectedAreaData?.AREA_NM]?.detailedCategories)}
          </div>
        </div>
      )}
    </div>
  );
};

export default Mapcomponent;
