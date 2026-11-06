"use client";
import {useParams} from "next/navigation";
import WorkspacePlaceholderPage from "../../../components/workspace-placeholder-page";
export default function BillingSectionPage(){const p=useParams<{section:string}>();return <WorkspacePlaceholderPage routeKey={"billing/"+p.section}/>;}
