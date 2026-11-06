import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './Layout';

// Страницы загружаются, только когда их открывают (главная — сразу).
import HomePage from './HomePage';
const HomePageNew = lazy(() => import('./HomePageNew')); // предпросмотр новой главной
const ReportPage = lazy(() => import('./ReportPage'));
const DailyTopPage = lazy(() => import('./DailyTopPage'));
const ModelStatusPage = lazy(() => import('./ModelStatusPage'));
const CheckpointMapPage = lazy(() => import('./CheckpointMapPage'));
const SgpAuditPage = lazy(() => import('./SgpAuditPage'));
const MppWeeklyTopPage = lazy(() => import('./MppWeeklyTopPage'));
const PartDefectSearchPage = lazy(() => import('./PartDefectSearchPage'));
const DrrReportPage = lazy(() => import('./DrrReportPage'));
const DailyDashboardPage = lazy(() => import('./DailyDashboardPage'));
const WarrantyPage = lazy(() => import('./WarrantyPage'));
const TLMapPage = lazy(() => import('./TLMapPage'));
const HoldsSgpPage = lazy(() => import('./HoldsSgpPage'));
const SgpManagementPage = lazy(() => import('./SgpManagementPage'));
const DrrCp7DashboardPage = lazy(() => import('./DrrCp7DashboardPage'));
import favicon from './assets/weblog.png';
const DrrCp7HistoryPage = lazy(() => import('./DrrCp7HistoryPage'));
const DrrCp8DashboardPage = lazy(() => import('./DrrCp8DashboardPage'));
const DrrTLDashboardPage = lazy(() => import('./DrrTLDashboardPage'));
const DrrPipDashboardPage = lazy(() => import('./DrrPipDashboardPage'));
const DefectElectronicsTopPage = lazy(() => import('./DefectElectronicsTopPage'));
const BrigadeReportPage = lazy(() => import('./BrigadeReportPage'));
const RemzoneWorkStatusPage = lazy(() => import('./RemzoneWorkStatusPage'));
const VehicleOnWheelsPage = lazy(() => import('./VehicleOnWheelsPage'));
const DrrWtPortalPage = lazy(() => import('./DrrWtPortalPage'));
const DrrCpFinalPage = lazy(() => import('./DrrCpFinalPage'));
const DrrCp6Page = lazy(() => import('./DrrCp6Page'));
const DrrCp5Page = lazy(() => import('./DrrCp5Page'));
const AllDrrDashboardPage = lazy(() => import('./AllDrrDashboardPage'));
const VrtReportPage = lazy(() => import('./VrtReportPage'));
const DrrShiftDashboardPage = lazy(() => import('./DrrShiftDashboardPage'));
const LineDefectCapturePage = lazy(() => import('./LineDefectCapturePage'));
const LineDefectsArchivePage = lazy(() => import('./LineDefectsArchivePage'));
const ReppsReportPage = lazy(() => import('./ReppsReportPage'));
const VoltageSpcPage = lazy(() => import('./VoltageSpcPage'));
const DrrCp7TupDashboardPage = lazy(() => import('./DrrCp7TupDashboardPage'));
const RepelecReportPage = lazy(() => import('./RepelecReportPage'));
const DrrElectronicsDashboardPage = lazy(() => import('./DrrElectronicsDashboardPage'));


const InspectionPage = lazy(() => import('./InspectionPage'));


export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/home-new" element={<HomePageNew />} />
        <Route path="/report" element={<ReportPage />} />
        <Route path="/daily-top" element={<DailyTopPage />} />
        <Route path="/model-status" element={<ModelStatusPage />} />
        <Route path="/checkpoint-map" element={<CheckpointMapPage />} />
        <Route path="/sgp-audit" element={<SgpAuditPage />} />
        <Route path="/sgp-management" element={<SgpManagementPage />} />
        <Route path="/mpp-weekly-top" element={<MppWeeklyTopPage />} />
        <Route path="/part-defect-search" element={<PartDefectSearchPage />} />
        <Route path="/drr-report" element={<DrrReportPage />} />
        <Route path="/daily-dashboard" element={<DailyDashboardPage />} />
        <Route path="/warranty" element={<WarrantyPage />} />
        <Route path="/tl-map" element={<TLMapPage />} />
        <Route path="/holds-sgp" element={<HoldsSgpPage />} />
        <Route path="/drr-cp7-dashboard" element={<DrrCp7DashboardPage />} />
        <Route path="/drr-cp7-history" element={<DrrCp7HistoryPage />} />
        <Route path="/drr-cp8-dashboard" element={<DrrCp8DashboardPage />} />
        <Route path="/drr-tl-dashboard" element={<DrrTLDashboardPage />} />
        <Route path="/drr-pip-dashboard" element={<DrrPipDashboardPage />} />
        <Route path="/defect-electronics-top" element={<DefectElectronicsTopPage />} />
        <Route path="/brigade-report" element={<BrigadeReportPage />} />
        <Route path="/remzone-work-status" element={<RemzoneWorkStatusPage />} />
        <Route path="/vehicle-on-wheels" element={<VehicleOnWheelsPage />} />
        <Route path="/drr-wt-portal-old" element={<DrrWtPortalPage />} />
        <Route path="/drr-wt-portal" element={<DrrCpFinalPage />} />
        <Route path="/drr-cp6" element={<DrrCp6Page />} />
        <Route path="/drr-cp5" element={<DrrCp5Page />} />
        <Route path="/all-drr-dashboard" element={<AllDrrDashboardPage />} />
        <Route path="/vrt-report" element={<VrtReportPage />} />
        <Route path="/drr-shift-dashboard" element={<DrrShiftDashboardPage />} />
        <Route path="/defect-capture" element={<LineDefectCapturePage />} />
        <Route path="/line-defects-archive" element={<LineDefectsArchivePage />} />
        <Route path="/repps-report" element={<ReppsReportPage />} />
        <Route path="/voltage-spc" element={<VoltageSpcPage />} />
        <Route path="/drr-cp7-tup" element={<DrrCp7TupDashboardPage />} />
        <Route path="/repelec-report" element={<RepelecReportPage />} />
        <Route path="/drr-electronics-dashboard" element={<DrrElectronicsDashboardPage />} />





        <Route path="/inspection" element={<InspectionPage />} />
      </Route>
    </Routes>
  );
}