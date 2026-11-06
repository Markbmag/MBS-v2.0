import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import HomePage from './HomePage';
import ReportPage from './ReportPage';
import DailyTopPage from './DailyTopPage';
import ModelStatusPage from './ModelStatusPage';
import CheckpointMapPage from './CheckpointMapPage';
import SgpAuditPage from './SgpAuditPage';
import MppWeeklyTopPage from './MppWeeklyTopPage';
import PartDefectSearchPage from './PartDefectSearchPage';
import DrrReportPage from './DrrReportPage';
import DailyDashboardPage from './DailyDashboardPage';
import WarrantyPage from './WarrantyPage';
import TLMapPage from './TLMapPage';
import HoldsSgpPage from './HoldsSgpPage';
import SgpManagementPage from './SgpManagementPage';
import DrrCp7DashboardPage from './DrrCp7DashboardPage';
import favicon from './assets/weblog.png';
import DrrCp7HistoryPage from './DrrCp7HistoryPage';
import DrrCp8DashboardPage from './DrrCp8DashboardPage';
import DrrTLDashboardPage from './DrrTLDashboardPage';
import DrrPipDashboardPage from './DrrPipDashboardPage';
import DefectElectronicsTopPage from './DefectElectronicsTopPage';
import BrigadeReportPage from './BrigadeReportPage';
import RemzoneWorkStatusPage from './RemzoneWorkStatusPage';
import VehicleOnWheelsPage from './VehicleOnWheelsPage';
import DrrWtPortalPage from './DrrWtPortalPage';
import DrrCpFinalPage from './DrrCpFinalPage';
import DrrCp6Page from './DrrCp6Page';
import DrrCp5Page from './DrrCp5Page';
import AllDrrDashboardPage from './AllDrrDashboardPage';
import VrtReportPage from './VrtReportPage';
import DrrShiftDashboardPage from './DrrShiftDashboardPage';
import LineDefectCapturePage from './LineDefectCapturePage';
import LineDefectsArchivePage from './LineDefectsArchivePage';
import ReppsReportPage from './ReppsReportPage';
import VoltageSpcPage from './VoltageSpcPage';
import DrrCp7TupDashboardPage from './DrrCp7TupDashboardPage';
import RepelecReportPage from './RepelecReportPage';
import DrrElectronicsDashboardPage from './DrrElectronicsDashboardPage';


import InspectionPage from './InspectionPage';


export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
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