// 로딩 화면 창 띄운 코드 
// 브라우저 열자마자 인구 혼잡도 바로 불러오게 자동으로 설정
// 30분마다 데이터를 받아와 새로고침 기능 설정
// 범례추가 및 api 새로고침 시간
// 팝업창 추가
// mapcomponent1.js
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import areaJson from './seoul116_place1.json';

mapboxgl.accessToken = 'pk.eyJ1Ijoia2diNDg1NCIsImEiOiJjbTJ1NDlmZ2YwOWljMmtvaWltZjFlZXdkIn0.aLnwIt7wXc7ir6vjkogdnQ';

const Mapcomponent1 = () => {
  const mapContainer = useRef(null);
  const [populationData, setPopulationData] = useState({});
  const [map, setMap] = useState(null);
  const [popup, setPopup] = useState(null);
  const [isLoading, setIsLoading] = useState(true); // 로딩 상태 추가
  const [updateTime, setUpdateTime] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState('');



  // API에서 인구 밀도 데이터 가져오기
  const fetchPopulationData = async () => {
    setIsLoading(true); //데이터를 가져오는 동안 로딩 시작
    console.log("Fetching population data...");

    const populationDensityData = {};
    const requests = areaJson.features.map((area) => {
      const url = `http://openapi.seoul.go.kr:8088/4b766c79436b67623632504c436862/xml/citydata_ppltn/1/5/${encodeURIComponent(area.properties.AREA_NM)}`;

      return fetch(url)
        .then(response => response.text())
        .then(data => {
          const parser = new DOMParser();
          const xml = parser.parseFromString(data, 'application/xml');
          const areaName = xml.getElementsByTagName('AREA_NM')[0]?.textContent;
          const populationMin = xml.getElementsByTagName('AREA_PPLTN_MIN')[0]?.textContent;
          const populationMax = xml.getElementsByTagName('AREA_PPLTN_MAX')[0]?.textContent;
          const congestionLevel = xml.getElementsByTagName('AREA_CONGEST_LVL')[0]?.textContent;
          populationDensityData[areaName] = { populationMin, populationMax };

          // 새로 추가: 업데이트 시간을 가져와서 상태에 저장
          const ppltnTime = xml.getElementsByTagName('PPLTN_TIME')[0]?.textContent;
          setUpdateTime(ppltnTime || 'Unknown time'); // 시간 정보가 없을 경우 'Unknown time'으로 표시

          // 혼잡도 데이터를 "여유", "보통", "약간 붐빔", "붐빔"으로 매핑
          let congestion = '여유'; // 기본값 설정
          if (congestionLevel === '붐빔') {
            congestion = '붐빔';  // '붐빔' -> High
          } else if (congestionLevel === '약간 붐빔') {
            congestion = '약간 붐빔'; // '약간 붐빔' -> MediumHigh
          } else if (congestionLevel === '보통') {
            congestion = '보통'; // '보통' -> Medium
          } else if (congestionLevel === '여유') {
            congestion = '여유';   // '여유' -> Low
          }

          populationDensityData[area.properties.AREA_NM] = {
            populationMin: parseInt(populationMin) || 0,
            populationMax: parseInt(populationMax) || 0,
            congestionLevel: congestion, // 혼잡도 수준 저장
          };
        })
        .catch(error => {
          console.error(`Error fetching data for ${area.properties.AREA_NM}:`, error);
        });
    });

    await Promise.all(requests); // 모든 요청이 완료될 때까지 기다림
    console.log("Finished fetching population data:", populationDensityData);
    setPopulationData(populationDensityData);
    setIsLoading(false); // 데이터 로드 완료시 로딩 종료
  };

  // Mapbox 초기화
  useEffect(() => {
    if (map) return;

    const initializeMap = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/kgb4854/cm2xeuvps002q01oj8wpfham3',
      center: [126.978, 37.5665],
      zoom: 11,
      language: "ko"
    });

    initializeMap.on('load', () => {
      setMap(initializeMap);
    });

    return () => {
      if (map) {
        map.remove();
      }
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;

    // 자동으로 인구 밀도 데이터 가져오기
    fetchPopulationData();

    // 30분마다 데이터 새로고침
    const interval = setInterval(fetchPopulationData, 30 * 60 * 1000); // 30 minutes interval

    return () => {
      clearInterval(interval); // component unmount 시 interval 클리어
    };
  }, [map]);

  useEffect(() => {
    if (!map || Object.keys(populationData).length === 0) return;

    // populationData에 있는 구역만 필터링하여 폴리곤 레이어 데이터 생성
    const polygonData = {
      type: 'FeatureCollection',
      features: areaJson.features
        .map((area) => {
          const density = populationData[area.properties.AREA_NM];
          if (!density) return null;

          return {
            type: 'Feature',
            geometry: area.geometry,
            properties: {
              congestionLevel: density.congestionLevel, // 혼잡도 수준
              populationMin: density.populationMin,     // 최소 인구수
              populationMax: density.populationMax,     // 최대 인구수
              AREA_NM: area.properties.AREA_NM,         // 지역 이름
            },
          };
        })
        .filter(Boolean), // null 값을 제거하여 유효한 데이터만 남김
    };

    // 기존에 데이터가 없으면 소스를 추가하고, 데이터가 있으면 업데이트
    if (map.getSource('populationDensity')) {
      map.getSource('populationDensity').setData(polygonData);
    } else {
      map.addSource('populationDensity', {
        type: 'geojson',
        data: polygonData,
      });

      map.addLayer({
        id: 'population-polygon',
        type: 'fill-extrusion',  // 3D 표현을 위해 'fill-extrusion' 사용
        source: 'populationDensity',
        paint: {
          'fill-extrusion-color': [
            'match',
            ['get', 'congestionLevel'],
            '여유', 'green',        // 혼잡도 Low - 초록색
            '보통', 'yellow',    // 혼잡도 Medium - 노란색
            '약간 붐빔', 'orange',// 혼잡도 MediumHigh - 주황색
            '붐빔', 'red',         // 혼잡도 High - 빨간색
            'gray',                // 기본 색상 (혼잡도가 없거나 다른 값일 경우)
          ],
          'fill-extrusion-height': [
            'match',
            ['get', 'congestionLevel'],
            '여유', 30,            // 'Low' - 30m
            '보통', 60,         // 'Medium' - 60m
            '약간 붐빔', 90,     // 'MediumHigh' - 90m
            '붐빔', 120,          // 'High' - 120m
            50,                   // 기본 높이 (혼잡도가 없거나 다른 값일 경우)
          ],
          'fill-extrusion-opacity': 0.3,
        },
      });
    }
    map.on('click', 'population-polygon', (e) => {
      const { AREA_NM, populationMin, populationMax, congestionLevel } = e.features[0].properties;
      const coordinates = e.lngLat;
      // populationData에서 지역에 대한 정보 가져오기
      const data = populationData[AREA_NM];
      // 값이 존재하는지 확인 후 팝업 내용 작성
      const popupHtml = `
    <strong>${AREA_NM}</strong><br>
    최소 인구수: ${data?.populationMin || 'N/A'}<br>
    최대 인구수: ${data?.populationMax || 'N/A'}<br>
    혼잡도: ${congestionLevel}
  `;
      if (popup) popup.remove();
      const newPopup = new mapboxgl.Popup({ closeButton: true })
        .setLngLat(coordinates)
        .setHTML(popupHtml)
        .addTo(map);
      setPopup(newPopup);
      // 팝업 내의 '닫기' 버튼에 대한 aria-hidden 처리
      const popupCloseButton = newPopup.getElement().querySelector('.mapboxgl-popup-close-button');
      if (popupCloseButton) {
        popupCloseButton.removeAttribute('aria-hidden'); // aria-hidden="true" 속성 제거
      }
    });

    map.on('mouseenter', 'population-polygon', () => {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'population-polygon', () => {
      map.getCanvas().style.cursor = '';
    });
    console.log("3D polygon data added to map");
  }, [map, populationData]);

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

  // 범례 스타일 정의
  const legendStyle = {
    position: 'absolute',
    bottom: '20px',
    right: '20px',
    backgroundColor: '#fff',
    padding: '10px',
    borderRadius: '5px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
  };

  const legendItemStyle = {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '5px',
  };

  const colorBoxStyle = (color) => ({
    width: '15px',
    height: '15px',
    backgroundColor: color,
    marginRight: '10px',
  });

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
    <div>
      {isLoading && <div style={loadingScreenStyle}>Loading data...</div>}
      <div
        ref={mapContainer}
        style={{ width: '100%', height: '100vh' }} />

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

      {/* 범례 */}
      <div style={legendStyle}>
        <div style={legendItemStyle}>
          <div style={colorBoxStyle('green')} />
          <span>여유</span>
        </div>
        <div style={legendItemStyle}>
          <div style={colorBoxStyle('yellow')} />
          <span>보통</span>
        </div>
        <div style={legendItemStyle}>
          <div style={colorBoxStyle('orange')} />
          <span>약간 붐빔</span>
        </div>
        <div style={legendItemStyle}>
          <div style={colorBoxStyle('red')} />
          <span>붐빔</span>
        </div>
        {/* 시간 표시 추가 */}
        <div style={{ marginTop: '10px', fontSize: '0.9rem', color: '#666' }}>
          <strong>업데이트 시간:</strong> {updateTime}
        </div>
      </div>
    </div>
  );
};

export default Mapcomponent1;
